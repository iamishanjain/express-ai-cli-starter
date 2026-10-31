export const APP_NAME = "expressforge";
export const APP_DISPLAY_NAME = "ExpressForge";
export const LEGACY_BIN_NAME = "create-express-ai";

export const KEYRING_SERVICE = "expressforge";
export const CONFIG_FILE_NAME = "config.json";
export const CREDENTIALS_FILE_NAME = "credentials.json";
export const CONFIG_DIR_ENV = "EXPRESSFORGE_CONFIG_DIR";
export const PROVIDER_ENV = "EXPRESSFORGE_PROVIDER";
export const MODEL_ENV = "EXPRESSFORGE_MODEL";

export const CURRENT_CONFIG_VERSION = 1;
export const DEFAULT_PROVIDER_ID = "gemini";
export const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
export const VALIDATION_TIMEOUT_MS = 20_000;

/** Same rule the original CLI used for the project (directory) name. */
export const PROJECT_NAME_PATTERN = /^[a-z0-9][a-z0-9-_]*$/i;
export const MIN_DESCRIPTION_LENGTH = 15;
export const MAX_DESCRIPTION_LENGTH = 4000;
