// artifacts/sourdough/lib/printUtils.ts
import { Alert, Platform } from "react-native";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";

/**
 * SafePrint prevents the "Another print request is already in progress" error
 * by managing a lock state for all printing operations.
 */
class SafePrintManager {
  private isBusy = false;
  private lockTimeout: ReturnType<typeof setTimeout> | null = null;

  private acquireLock() {
    if (this.isBusy) return false;
    this.isBusy = true;
    // Safety fallback: auto-release lock after 15 seconds if it gets stuck
    this.lockTimeout = setTimeout(() => {
      this.isBusy = false;
      this.lockTimeout = null;
    }, 15000);
    return true;
  }

  private releaseLock() {
    if (this.lockTimeout) {
      clearTimeout(this.lockTimeout);
      this.lockTimeout = null;
    }
    // Adding a small delay helps the OS spooler settle
    setTimeout(() => {
      this.isBusy = false;
    }, 800);
  }

  async printHtml(html: string): Promise<void> {
    if (!this.acquireLock()) {
      console.warn("[SafePrint] A print request is already in progress. Ignoring.");
      return;
    }

    if (Platform.OS === "web") {
      const w = window.open("", "_blank");
      if (w) {
        w.document.write(html);
        w.document.close();
        w.print();
      }
      this.releaseLock();
      return;
    }

    try {
      await Print.printAsync({ html });
    } catch (e: any) {
      if (e.message?.includes("already in progress")) {
        // Silently ignore
      } else {
        console.error("[SafePrint] Print error", e);
        Alert.alert("Print Error", "Could not open print dialog. Please try again.");
      }
    } finally {
      this.releaseLock();
    }
  }

  async sharePdf(html: string, dialogTitle: string): Promise<void> {
    if (!this.acquireLock()) {
      console.warn("[SafePrint] A share/print request is already in progress. Ignoring.");
      return;
    }

    if (Platform.OS === "web") {
      const w = window.open("", "_blank");
      if (w) {
        w.document.write(html);
        w.document.close();
        w.print();
      }
      this.releaseLock();
      return;
    }

    try {
      const isAvailable = await Sharing.isAvailableAsync();
      if (!isAvailable) {
        Alert.alert("Sharing not available", "Sharing is not supported on this device.");
        return;
      }

      const { uri } = await Print.printToFileAsync({ html });
      await Sharing.shareAsync(uri, {
        mimeType: "application/pdf",
        dialogTitle,
        UTI: "com.adobe.pdf",
      });
    } catch (e: any) {
      if (e.message?.includes("already in progress")) {
        // Ignore
      } else {
        console.error("[SafePrint] Share error", e);
        Alert.alert("Error", "Could not generate PDF. Please try again.");
      }
    } finally {
      this.releaseLock();
    }
  }
}

export const SafePrint = new SafePrintManager();