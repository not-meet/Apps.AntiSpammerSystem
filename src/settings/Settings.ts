import { ISetting, SettingType } from '@rocket.chat/apps-engine/definition/settings';

export enum AppSetting {
    MonitoringWindowDays = 'antispam_monitoring_window_days',
    SlidingWindowSeconds = 'antispam_sliding_window_seconds',
    CrossChannelThreshold = 'antispam_cross_channel_threshold',
    AdminChannelName = 'antispam_admin_channel',
}

export const APP_SETTINGS: ISetting[] = [
    {
        id: AppSetting.MonitoringWindowDays,
        type: SettingType.NUMBER,
        packageValue: 42,
        required: true,
        public: false,
        i18nLabel: 'Monitoring Window (days)',
        i18nDescription: 'Track new users for this many days after account creation (default: 42 = 6 weeks)',
    },
    {
        id: AppSetting.SlidingWindowSeconds,
        type: SettingType.NUMBER,
        packageValue: 300,
        required: true,
        public: false,
        i18nLabel: 'Sliding Window (seconds)',
        i18nDescription: 'Time window for detecting duplicate/cross-channel messages (default: 300 = 5 min)',
    },
    {
        id: AppSetting.CrossChannelThreshold,
        type: SettingType.NUMBER,
        packageValue: 3,
        required: true,
        public: false,
        i18nLabel: 'Cross-Channel Threshold',
        i18nDescription: 'Number of distinct channels a duplicate must appear in to trigger action (default: 3)',
    },
    {
        id: AppSetting.AdminChannelName,
        type: SettingType.STRING,
        packageValue: 'antispam-admin',
        required: true,
        public: false,
        i18nLabel: 'Admin Channel Name',
        i18nDescription: 'Private channel name for admin alerts and bot interaction',
    },
];
