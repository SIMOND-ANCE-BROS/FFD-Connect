/**
 * Platform adapters for web compatibility
 * Provides web-compatible implementations for native-only modules
 */

import * as Device from "expo-device";
import {
  cacheDirectory,
  deleteAsync,
  getInfoAsync,
  readAsStringAsync,
  writeAsStringAsync,
} from "expo-file-system/legacy";
import { Platform, Share } from "react-native";

interface NavigatorWithShare extends Navigator {
  share?: (data: {
    title?: string;
    text?: string;
    url?: string;
  }) => Promise<void>;
  clipboard: { writeText: (text: string) => Promise<void> };
}

/**
 * File System Adapter
 * Uses expo-file-system for Native and localStorage for Web
 */
export const FileSystemAdapter = {
  CachesDirectoryPath: Platform.select({
    web: "/cache",
    default: cacheDirectory,
  }),

  exists: async (path: string): Promise<boolean> => {
    if (Platform.OS === "web") {
      try {
        const cache = localStorage.getItem(`file_cache_${path}`);
        return cache !== null;
      } catch {
        return false;
      }
    }
    const info = await getInfoAsync(path);
    return info.exists;
  },

  writeFile: async (
    path: string,
    content: string,
    encoding?: string,
  ): Promise<void> => {
    if (Platform.OS === "web") {
      localStorage.setItem(`file_cache_${path}`, content);
      return;
    }
    await writeAsStringAsync(path, content, {
      encoding: encoding === "base64" ? "base64" : "utf8",
    });
  },

  readFile: async (path: string, encoding?: string): Promise<string> => {
    if (Platform.OS === "web") {
      const content = localStorage.getItem(`file_cache_${path}`);
      if (!content) {
        throw new Error(`File not found: ${path}`);
      }
      return content;
    }
    return readAsStringAsync(path, {
      encoding: encoding === "base64" ? "base64" : "utf8",
    });
  },

  unlink: async (path: string): Promise<void> => {
    if (Platform.OS === "web") {
      localStorage.removeItem(`file_cache_${path}`);
      return;
    }
    await deleteAsync(path, { idempotent: true });
  },
};

/**
 * Device Info Adapter
 * Uses expo-device
 */
export const DeviceInfoAdapter = {
  isEmulator: (): boolean => {
    if (Platform.OS === "web") return false;
    return !Device.isDevice;
  },

  getModel: (): string => {
    if (Platform.OS === "web") return navigator.userAgent;
    return Device.modelName ?? "Unknown Device";
  },
};

/**
 * HTML to PDF Adapter
 * Uses expo-print on native, blob URL on web
 */
export const PDFAdapter = {
  generatePDF: async (options: {
    html: string;
    fileName?: string;
  }): Promise<{ filePath: string }> => {
    if (Platform.OS === "web") {
      const blob = new Blob([options.html], {
        type: "text/html",
        lastModified: Date.now(),
      });
      const url = URL.createObjectURL(blob);
      return { filePath: url };
    }
    const Print = await import("expo-print");
    const { uri } = await Print.printToFileAsync({ html: options.html });
    return { filePath: uri };
  },
};

/**
 * Share Adapter
 * Provides web-compatible sharing functionality
 */
export const ShareAdapter = {
  open: async (options: {
    url?: string;
    title?: string;
    message?: string;
  }): Promise<{ action: string }> => {
    if (Platform.OS === "web") {
      const nav = navigator as NavigatorWithShare;
      if (nav.share) {
        await nav.share({
          title: options.title,
          text: options.message,
          url: options.url,
        });
        return { action: "sharedAction" };
      }
      if (options.url) {
        await nav.clipboard.writeText(options.url);
        return { action: "sharedAction" };
      }
      throw new Error("Web Share API not available");
    }
    return Share.share({
      title: options.title,
      message: options.message ?? "",
      url: options.url,
    });
  },
};
