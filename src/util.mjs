export const green = (s) => `\x1b[32m${s}\x1b[0m`;
export const red = (s) => `\x1b[31m${s}\x1b[0m`;
export const yellow = (s) => `\x1b[33m${s}\x1b[0m`;

// App Store char limits (validated before upload so nothing eats a mid-upload rejection).
export const LIMITS = { name: 30, subtitle: 30, keywords: 100, promotional_text: 170, iap_display_name: 30, iap_description: 45 };

// Version-localization text fields (name/subtitle live on AppInfo). key = the ASC camelCase attribute.
export const VERSION_FIELDS = { description: "description", keywords: "keywords", promotional_text: "promotionalText" };
