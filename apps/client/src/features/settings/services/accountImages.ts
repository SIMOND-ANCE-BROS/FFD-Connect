import {
  cacheDirectory,
  deleteAsync,
  documentDirectory,
} from "expo-file-system/legacy";
import { createLogger } from "../../../utils/logger";

const logger = createLogger("accountImages");

/**
 * Where expo-image-picker copies each picked image (in the app's cache): every
 * selection leaves its own copy there, earlier ones included.
 */
const IMAGE_PICKER_DIR = "ImagePicker/";

/** A file in the app's own folders, never a gallery original or a URL. */
function isAppFile(uri: string | undefined): uri is string {
  if (!uri || uri.includes("..")) return false;
  return [documentDirectory, cacheDirectory].some(
    (dir) => !!dir && uri.startsWith(dir),
  );
}

/**
 * Account deleted (#936): the local images of the account (licence photo,
 * club logo — the photo of a licensee, maybe a minor) and every image picker
 * copy. The stored URI may point at an older app container after an update,
 * hence the picker folder too. Never throws.
 */
export async function deleteAccountImages(
  uris: readonly (string | undefined)[],
): Promise<void> {
  const targets = uris.filter(isAppFile);
  if (cacheDirectory) targets.push(`${cacheDirectory}${IMAGE_PICKER_DIR}`);
  for (const uri of targets) {
    try {
      await deleteAsync(uri, { idempotent: true });
    } catch (error) {
      logger.warn("Account image deletion failed", error);
    }
  }
}
