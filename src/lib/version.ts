/**
 * The app version, as it appears in a backup file.
 *
 * Kept as a literal rather than read from `package.json` at runtime: the whole
 * app is a static export, and bundling the manifest into the client would ship
 * the dependency list to every device for the sake of one string. Keep it in
 * step with `package.json` when the version is bumped — the backup format has its
 * own independent version, and conflating the two would make a UI release look
 * like a compatibility break.
 */
export const APP_VERSION = '0.1.0';
