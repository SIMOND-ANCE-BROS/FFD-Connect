export const RNFSFileTypeRegular = 0;
export const RNFSFileTypeDirectory = 1;
export const MainBundlePath = "";
export const CachesDirectoryPath = "";
export const DocumentDirectoryPath = "";
export const ExternalDirectoryPath = "";
export const ExternalStorageDirectoryPath = "";
export const TemporaryDirectoryPath = "";
export const LibraryDirectoryPath = "";
export const PicturesDirectoryPath = "";

export const mkdir = () => {};
export const moveFile = () => {};
export const copyFile = () => {};
export const pathForBundle = () => "";
export const pathForGroup = () => "";
export const getFSInfo = () => ({});
export const getAllExternalFilesDirs = () => [];
export const unlink = () => {};
export const exists = () => false;
export const stopDownload = () => {};
export const resumeDownload = () => {};
export const isResumable = () => false;
export const stopUpload = () => {};
export const completeHandlerIOS = () => {};
export const readDir = () => [];
export const readDirAssets = () => [];
export const existsAssets = () => false;
export const readdir = () => [];
export const setReadable = () => {};
export const stat = () => ({});
export const readFile = () => "";
export const read = () => "";
export const readFileAssets = () => "";
export const hash = () => "";
export const copyFileAssets = () => {};
export const copyFileAssetsIOS = () => {};
export const copyAssetsVideoIOS = () => {};
export const writeFile = () => {};
export const appendFile = () => {};
export const write = () => {};
export const downloadFile = () => ({ jobId: 1, promise: Promise.resolve() });
export const uploadFiles = () => ({ jobId: 1, promise: Promise.resolve() });
export const touch = () => {};
export default {
  RNFSFileTypeRegular,
  RNFSFileTypeDirectory,
  MainBundlePath,
  CachesDirectoryPath,
  DocumentDirectoryPath,
  ExternalDirectoryPath,
  ExternalStorageDirectoryPath,
  TemporaryDirectoryPath,
  LibraryDirectoryPath,
  PicturesDirectoryPath,
  mkdir,
  moveFile,
  copyFile,
  pathForBundle,
  pathForGroup,
  getFSInfo,
  getAllExternalFilesDirs,
  unlink,
  exists,
  stopDownload,
  resumeDownload,
  isResumable,
  stopUpload,
  completeHandlerIOS,
  readDir,
  readDirAssets,
  existsAssets,
  readdir,
  setReadable,
  stat,
  readFile,
  read,
  readFileAssets,
  hash,
  copyFileAssets,
  copyFileAssetsIOS,
  copyAssetsVideoIOS,
  writeFile,
  appendFile,
  write,
  downloadFile,
  uploadFiles,
  touch,
};
