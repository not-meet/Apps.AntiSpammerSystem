"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CHAOS_LABELS = exports.COOLDOWN_DURATIONS = exports.ChaosLevel = void 0;
var ChaosLevel;
(function (ChaosLevel) {
    ChaosLevel[ChaosLevel["Clean"] = 0] = "Clean";
    ChaosLevel[ChaosLevel["Warning"] = 1] = "Warning";
    ChaosLevel[ChaosLevel["Cooldown"] = 2] = "Cooldown";
    ChaosLevel[ChaosLevel["Restricted"] = 3] = "Restricted";
    ChaosLevel[ChaosLevel["AdminReview"] = 4] = "AdminReview";
})(ChaosLevel = exports.ChaosLevel || (exports.ChaosLevel = {}));
exports.COOLDOWN_DURATIONS = {
    [ChaosLevel.Clean]: 0,
    [ChaosLevel.Warning]: 0,
    [ChaosLevel.Cooldown]: 60000,
    [ChaosLevel.Restricted]: 600000,
    [ChaosLevel.AdminReview]: Number.MAX_SAFE_INTEGER,
};
exports.CHAOS_LABELS = {
    [ChaosLevel.Clean]: 'Clean',
    [ChaosLevel.Warning]: 'Warning',
    [ChaosLevel.Cooldown]: 'Cooldown (1 min)',
    [ChaosLevel.Restricted]: 'Restricted (10 min)',
    [ChaosLevel.AdminReview]: 'Admin Review',
};
