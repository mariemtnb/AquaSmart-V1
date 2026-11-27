"""
Federated Learning engine for AquaSmart.

Architecture:
  - Each fish pond is a *client* that trains a local Ridge regression model
    on its private sensor data (data never leaves the client).
  - A central *server* aggregates parameters using FedAvg:
        w_global = Σ (n_k / N) · w_k
  - Optional Gaussian differential-privacy noise on gradients.
  - All numpy/sklearn imports are LAZY (inside functions) so this module
    can be imported without touching numpy before asyncio starts.
"""

from __future__ import annotations
import json, math, pickle, logging, threading
from copy import deepcopy
from datetime import datetime
from typing import Optional

from app.config import MODELS_DIR

logger = logging.getLogger(__name__)

N_FEATURES    = 21
ALPHA         = 1.0
LOCAL_EPOCHS  = 5
LEARNING_RATE = 0.01
FEDPROX_MU    = 0.1     # poids du terme proximal FedProx (gere l'heterogeneite non-IID)
SERVER_LR     = 0.05    # learning rate serveur pour FedAdam

# Strategie d'agregation par defaut. FedProx a remporte la comparaison
# (cf. notebook fl-comparison.ipynb) : meilleur compromis RMSE/confidentialite
# sur donnees non-IID. Valeurs possibles : fedprox | fedavg | fedmedian | fedadam.
DEFAULT_STRATEGY = "fedprox"


# ─── Lazy import helpers ────────────────────────────────────────────────────
def _np():
    import numpy; return numpy

def _fresh_ridge():
    from sklearn.linear_model import Ridge
    import numpy as np
    m = Ridge(alpha=ALPHA, fit_intercept=True)
    m.coef_      = np.zeros((1, N_FEATURES))
    m.intercept_ = np.zeros(1)
    return m

def _get_params(model):
    import numpy as np
    return np.concatenate([model.coef_.flatten(), [model.intercept_[0]]])

def _set_params(model, params):
    import numpy as np
    model.coef_      = params[:-1].reshape(1, -1)
    model.intercept_ = np.array([params[-1]])

def _compute_loss(model, X, y):
    from sklearn.metrics import mean_squared_error
    return float(mean_squared_error(y, model.predict(X)))


# ─── Synthetic pond data ────────────────────────────────────────────────────
def _generate_pond_data(pond_id: int, n: int = 400):
    import numpy as np
    from app.services.ml_service import _engineer

    rng        = np.random.default_rng(pond_id * 137 + 42)
    temp_bias  = rng.uniform(-2, 2)
    do_bias    = rng.uniform(-0.5, 0.5)
    pop_scale  = rng.uniform(0.7, 1.4)

    temp = np.clip(rng.normal(24 + temp_bias, 2.0, n), 10, 38)
    do   = np.clip(rng.normal(7.0 + do_bias,  1.0, n),  1, 12)
    ph   = np.clip(rng.normal(7.2,             0.4, n),  5, 10)
    turb = np.clip(rng.exponential(12, n), 0, 80)
    ammo = np.clip(rng.exponential(0.008, n), 0, 0.1)
    nit  = np.clip(rng.exponential(3, n), 0, 20)
    fw   = np.clip(rng.normal(80 * pop_scale, 30, n), 5, 500)

    rows, targets = [], []
    for i in range(n):
        rows.append(_engineer({"temperature": temp[i], "dissolved_oxygen": do[i],
                                "ph": ph[i], "turbidity": turb[i],
                                "ammonia": ammo[i], "nitrate": nit[i],
                                "fish_weight_g": fw[i]}))
        base = fw[i] * 0.03
        tf   = 1.1 if 22 <= temp[i] <= 26 else (0.5 if temp[i] < 18 else 0.8)
        df   = 1.05 if do[i] >= 7 else (0.5 if do[i] >= 3 else 0.0)
        pf   = 1.0  if 6.8 <= ph[i] <= 8.2 else 0.6
        targets.append(max(0.0, base * tf * df * pf + rng.normal(0, 0.4)))

    return np.array(rows, dtype=np.float32), np.array(targets, dtype=np.float32)


# ─── Client ─────────────────────────────────────────────────────────────────
class FederatedClient:
    def __init__(self, client_id: int, pond_name: str, n_samples: int = 400):
        from sklearn.preprocessing import RobustScaler
        self.client_id = client_id
        self.pond_name = pond_name
        self.n_samples = n_samples
        self.scaler    = RobustScaler()
        self._trained  = False
        X_raw, y = _generate_pond_data(client_id, n_samples)
        self.X   = self.scaler.fit_transform(X_raw)
        self.y   = y

    def local_train(self, global_params, dp_noise_std: float = 0.0, mu: float = 0.0):
        import numpy as np
        model = _fresh_ridge()
        _set_params(model, global_params.copy())
        n, _ = self.X.shape
        params = _get_params(model)
        w, b   = params[:-1], params[-1]
        gw0    = global_params[:-1]      # ancre proximale (FedProx)
        batch  = max(32, n // 8)
        for _ in range(LOCAL_EPOCHS):
            idx = np.random.permutation(n)
            for start in range(0, n, batch):
                ib  = idx[start:start + batch]
                Xb, yb = self.X[ib], self.y[ib]
                err = Xb @ w + b - yb
                gw  = (2 / len(ib)) * (Xb.T @ err) + 2 * ALPHA * w + mu * (w - gw0)
                gb  = (2 / len(ib)) * err.sum()
                if dp_noise_std > 0:
                    gw += np.random.normal(0, dp_noise_std, gw.shape)
                    gb += float(np.random.normal(0, dp_noise_std))
                w -= LEARNING_RATE * gw
                b -= LEARNING_RATE * gb
        new_params = np.append(w, b)
        _set_params(model, new_params)
        loss = _compute_loss(model, self.X, self.y)
        self._trained = True
        return new_params, n, loss

    def evaluate(self, params):
        import numpy as np
        from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
        model = _fresh_ridge()
        _set_params(model, params)
        pred = model.predict(self.X)
        return {
            "mae":  round(float(mean_absolute_error(self.y, pred)), 4),
            "rmse": round(float(np.sqrt(mean_squared_error(self.y, pred))), 4),
            "r2":   round(float(r2_score(self.y, pred)), 4),
        }


# ─── Server ─────────────────────────────────────────────────────────────────
_LOCK = threading.Lock()


class FederatedServer:
    def __init__(self):
        import numpy as np
        self._global_params = np.zeros(N_FEATURES + 1)
        self.clients: list[FederatedClient] = []
        self.rounds_history: list[dict] = []
        self.status        = "idle"
        self.current_round = 0
        self.total_rounds  = 0
        self.strategy      = DEFAULT_STRATEGY
        self.started_at    = ""
        self.finished_at   = ""
        self.error_msg     = ""
        self._adam_m       = None
        self._adam_v       = None
        self._thread: Optional[threading.Thread] = None

    def _init_clients(self, n_ponds: int = 8):
        import numpy as np
        self.clients = [
            FederatedClient(i + 1, f"Pond {i + 1}", int(np.random.randint(300, 600)))
            for i in range(n_ponds)
        ]

    def _aggregate(self, updates, rnd):
        """Agregation serveur selon la strategie choisie.
        updates : liste de (params, n_samples)."""
        import numpy as np
        total   = sum(n for _, n in updates)
        weights = np.array([w for w, _ in updates])
        ns      = np.array([n for _, n in updates], dtype=float)

        if self.strategy == "fedmedian":
            return np.median(weights, axis=0)

        avg = (ns[:, None] * weights).sum(0) / total      # FedAvg pondere

        if self.strategy in ("fedavg", "fedprox"):
            return avg

        if self.strategy == "fedadam":
            b1, b2, tau = 0.9, 0.999, 1e-3
            if self._adam_m is None:
                self._adam_m = np.zeros_like(self._global_params)
                self._adam_v = np.zeros_like(self._global_params)
            delta = avg - self._global_params               # pseudo-gradient serveur
            self._adam_m = b1 * self._adam_m + (1 - b1) * delta
            self._adam_v = b2 * self._adam_v + (1 - b2) * delta ** 2
            mhat = self._adam_m / (1 - b1 ** rnd)
            vhat = self._adam_v / (1 - b2 ** rnd)
            return self._global_params + SERVER_LR * mhat / (np.sqrt(vhat) + tau)

        return avg

    def _run_rounds(self, n_rounds: int, dp_noise_std: float):
        try:
            import numpy as np
            mu = FEDPROX_MU if self.strategy == "fedprox" else 0.0
            for rnd in range(1, n_rounds + 1):
                with _LOCK:
                    self.current_round = rnd
                updates, client_info = [], []
                for client in self.clients:
                    params, n, loss = client.local_train(
                        self._global_params.copy(), dp_noise_std, mu=mu)
                    updates.append((params, n))
                    client_info.append({"pond": client.pond_name,
                                        "samples": n, "local_loss": round(loss, 5)})
                new_params = self._aggregate(updates, rnd)
                metrics    = [c.evaluate(new_params) for c in self.clients]
                avg_mae    = round(float(np.mean([m["mae"]  for m in metrics])), 4)
                avg_rmse   = round(float(np.mean([m["rmse"] for m in metrics])), 4)
                avg_r2     = round(float(np.mean([m["r2"]   for m in metrics])), 4)
                with _LOCK:
                    self._global_params = new_params
                    self.rounds_history.append({
                        "round": rnd, "avg_mae": avg_mae,
                        "avg_rmse": avg_rmse, "avg_r2": avg_r2,
                        "clients": client_info, "ts": datetime.now().isoformat(),
                    })
                logger.info("FL round %d/%d  RMSE=%.4f  R²=%.4f",
                            rnd, n_rounds, avg_rmse, avg_r2)
            self._save()
            with _LOCK:
                self.status      = "done"
                self.finished_at = datetime.now().isoformat()
        except Exception as exc:
            logger.exception("FL training error")
            with _LOCK:
                self.status    = "error"
                self.error_msg = str(exc)

    def start_training(self, n_rounds=10, n_ponds=8, dp_noise=0.0, strategy=DEFAULT_STRATEGY):
        import numpy as np
        if self.status == "training":
            return False, "Training already in progress."
        strategy = strategy if strategy in ("fedprox", "fedavg", "fedmedian", "fedadam") else DEFAULT_STRATEGY
        self._init_clients(n_ponds)
        self._global_params = np.zeros(N_FEATURES + 1)
        self._adam_m = self._adam_v = None
        self.strategy       = strategy
        self.rounds_history = []
        self.current_round  = 0
        self.total_rounds   = n_rounds
        self.status         = "training"
        self.started_at     = datetime.now().isoformat()
        self.finished_at    = ""
        self.error_msg      = ""
        self._thread = threading.Thread(target=self._run_rounds,
                                        args=(n_rounds, dp_noise), daemon=True)
        self._thread.start()
        return True, "Federated training started."

    def get_state(self) -> dict:
        with _LOCK:
            last = self.rounds_history[-1] if self.rounds_history else {}
            return {
                "status":          self.status,
                "strategy":        self.strategy,
                "current_round":   self.current_round,
                "total_rounds":    self.total_rounds,
                "progress_pct":    round(100 * self.current_round / max(self.total_rounds, 1), 1),
                "n_clients":       len(self.clients),
                "started_at":      self.started_at,
                "finished_at":     self.finished_at,
                "error":           self.error_msg,
                "latest_rmse":     last.get("avg_rmse"),
                "latest_r2":       last.get("avg_r2"),
                "model_saved":     (MODELS_DIR / "federated_model.pkl").exists(),
                "rounds_history":  self.rounds_history,
            }

    def _save(self):
        from sklearn.preprocessing import RobustScaler
        model = _fresh_ridge()
        _set_params(model, self._global_params)
        scaler = deepcopy(self.clients[0].scaler) if self.clients else RobustScaler()
        with open(MODELS_DIR / "federated_model.pkl",  "wb") as f: pickle.dump(model,  f)
        with open(MODELS_DIR / "federated_scaler.pkl", "wb") as f: pickle.dump(scaler, f)
        last = self.rounds_history[-1] if self.rounds_history else {}
        json.dump({
            "model": f"{self.strategy.capitalize()} Ridge (Federated)",
            "strategy": self.strategy, "task": "regression",
            "features": [f"feat_{i}" for i in range(N_FEATURES)],
            "training_samples": sum(c.n_samples for c in self.clients),
            "n_clients": len(self.clients), "rounds": self.total_rounds,
            "final_rmse": last.get("avg_rmse"), "final_r2": last.get("avg_r2"),
        }, open(MODELS_DIR / "federated_meta.json", "w"), indent=2)
        logger.info("Federated model saved.")

    def predict(self, features) -> Optional[float]:
        try:
            model = _fresh_ridge()
            with _LOCK:
                _set_params(model, self._global_params.copy())
            X_sc = (self.clients[0].scaler.transform(features.reshape(1, -1))
                    if self.clients else features.reshape(1, -1))
            return float(max(0, model.predict(X_sc)[0]))
        except Exception:
            return None


# ─── Singleton ───────────────────────────────────────────────────────────────
_server: Optional[FederatedServer] = None


def get_server() -> FederatedServer:
    global _server
    if _server is None:
        _server = FederatedServer()
        fed_path = MODELS_DIR / "federated_model.pkl"
        if fed_path.exists():
            try:
                with open(fed_path, "rb") as f:
                    saved = pickle.load(f)
                _server._global_params = _get_params(saved)
                _server.status = "done"
                logger.info("Restored saved federated model.")
            except Exception:
                pass
    return _server
