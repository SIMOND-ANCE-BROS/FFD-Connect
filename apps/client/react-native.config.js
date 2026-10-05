module.exports = {
  dependencies: {
    "ffmpeg-kit-react-native": {
      platforms: {
        ios: null, // Disable autolinking on iOS so we can manually link the fork in Podfile
      },
    },
  },
};
