import * as Sentry from "@sentry/react-native";
import { AlertCircle } from "lucide-react-native";
import React, { Component, ErrorInfo, ReactNode } from "react";
import { Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ReportService } from "../features/competitions/services/ReportService";
import { createLogger } from "../utils/logger";

const logger = createLogger("ErrorBoundary");

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({
      error,
      errorInfo,
    });
    logger.error("Uncaught error in ErrorBoundary", error, {
      componentStack: errorInfo.componentStack,
    });
    Sentry.captureException(error, {
      contexts: {
        react: { componentStack: errorInfo.componentStack ?? "" },
      },
    });
  }

  private handleReport = async () => {
    if (this.state.error) {
      await ReportService.sendReport({
        type: "BUG",
        title: `App Crash: ${this.state.error.message}`,
        description: "Automatic crash report from ErrorBoundary",
        stackTrace: `${this.state.error.stack}\n${
          this.state.errorInfo?.componentStack ?? ""
        }`,
      });
      Alert.alert("Merci", "Rapport envoyé. Merci !");
      this.handleReset();
    }
  };

  private handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  public render() {
    if (this.state.hasError) {
      return (
        <SafeAreaView style={styles.container}>
          <View style={styles.content}>
            <AlertCircle size={64} color="#e74c3c" />
            <Text style={styles.title}>Oups !</Text>
            <Text style={styles.message}>Une erreur est survenue.</Text>

            <View style={styles.debugBox}>
              <Text style={styles.debugText} numberOfLines={5}>
                {this.state.error?.toString()}
              </Text>
            </View>

            <TouchableOpacity
              accessibilityRole="button"
              style={styles.button}
              onPress={() => {
                this.handleReport().catch(() => {});
              }}
            >
              <Text style={styles.buttonText}>Signaler au développeur</Text>
            </TouchableOpacity>

            <TouchableOpacity
              accessibilityRole="button"
              style={[styles.button, styles.secondaryButton]}
              onPress={this.handleReset}
            >
              <Text style={[styles.buttonText, styles.secondaryButtonText]}>
                Réessayer
              </Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
    justifyContent: "center",
    alignItems: "center",
  },
  content: {
    padding: 20,
    alignItems: "center",
    width: "100%",
  },
  title: {
    fontSize: 32,
    fontWeight: "bold",
    marginTop: 20,
    marginBottom: 10,
    color: "#333",
  },
  message: {
    fontSize: 16,
    color: "#666",
    marginBottom: 30,
    textAlign: "center",
  },
  debugBox: {
    padding: 10,
    backgroundColor: "#f0f0f0",
    borderRadius: 8,
    marginBottom: 30,
    width: "100%",
    maxHeight: 150,
  },
  debugText: {
    fontFamily: "monospace",
    fontSize: 12,
    color: "#333",
  },
  button: {
    backgroundColor: "#3498db",
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    width: "100%",
    alignItems: "center",
    marginBottom: 10,
  },
  buttonText: {
    color: "white",
    fontWeight: "600",
    fontSize: 16,
  },
  secondaryButton: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "#3498db",
  },
  secondaryButtonText: {
    color: "#3498db",
  },
});
