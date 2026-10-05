interface NavigatorWithShare extends Navigator {
  share?: (data: {
    title?: string;
    text?: string;
    url?: string;
  }) => Promise<void>;
}

export const isAvailableAsync = () => {
  return !!(navigator as NavigatorWithShare).share;
};

export const shareAsync = async (
  url: string,
  options: { dialogTitle?: string; UTI?: string } = {},
) => {
  const nav = navigator as NavigatorWithShare;
  if (nav.share) {
    await nav.share({
      title: options.dialogTitle ?? "Partager",
      text: options.UTI,
      url: url,
    });
  } else {
    console.warn(`Partage simulé: ${url}`);
  }
};
