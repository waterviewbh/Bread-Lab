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

  async printHtml(html: string): Promise<void> {
    if (this.isBusy) {
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
      return;
    }

    try {
      this.isBusy = true;
      await Print.printAsync({ html });
    } catch (e: any) {
      if (e.message?.includes("already in progress")) {
        // Silently ignore if the OS/Expo already thinks we're printing
      } else {
        Alert.alert("Print Error", "Could not open print dialog. Please try again.");
      }
    } finally {
      // Adding a small delay helps the Android spooler settle
      setTimeout(() => {
        this.isBusy = false;
      }, 500);
    }
  }

  async sharePdf(html: string, dialogTitle: string): Promise<void> {
    if (this.isBusy) {
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
      return;
    }

    try {
      this.isBusy = true;
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
        Alert.alert("Error", "Could not generate PDF. Please try again.");
      }
    } finally {
      setTimeout(() => {
        this.isBusy = false;
      }, 500);
    }
  }
}

export const SafePrint = new SafePrintManager();