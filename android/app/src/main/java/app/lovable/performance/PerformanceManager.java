package app.lovable.performance;

import android.app.Activity;
import android.os.Build;
import android.os.PowerManager;
import android.content.Context;
import android.util.Log;
import android.view.Window;
import android.view.WindowManager;

/**
 * PerformanceManager - Enables sustained performance mode on Android.
 * This prevents CPU/GPU throttling during intensive camera/scanning operations.
 */
public class PerformanceManager {
    private static final String TAG = "PerformanceManager";
    private static boolean sustainedModeEnabled = false;

    /**
     * Enable sustained performance mode on the given activity.
     * Only effective on Android N (API 24) and above.
     * Silently does nothing on older versions.
     */
    public static void enableSustained(Activity activity) {
        if (activity == null) {
            Log.w(TAG, "Activity is null, cannot enable sustained mode");
            return;
        }

        if (sustainedModeEnabled) {
            Log.d(TAG, "Sustained mode already enabled");
            return;
        }

        try {
            // Sustained performance mode requires API 24+
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                Window window = activity.getWindow();
                if (window != null) {
                    window.setSustainedPerformanceMode(true);
                    sustainedModeEnabled = true;
                    Log.i(TAG, "Sustained performance mode ENABLED");
                }
            } else {
                Log.d(TAG, "Sustained mode not available (API < 24)");
            }

            // Keep screen on during scanning sessions
            activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            Log.d(TAG, "Keep screen on flag set");

        } catch (Exception e) {
            Log.e(TAG, "Failed to enable sustained mode: " + e.getMessage());
        }
    }

    /**
     * Disable sustained performance mode.
     */
    public static void disableSustained(Activity activity) {
        if (activity == null) return;

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && sustainedModeEnabled) {
                Window window = activity.getWindow();
                if (window != null) {
                    window.setSustainedPerformanceMode(false);
                    sustainedModeEnabled = false;
                    Log.i(TAG, "Sustained performance mode DISABLED");
                }
            }

            activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            Log.d(TAG, "Keep screen on flag cleared");

        } catch (Exception e) {
            Log.e(TAG, "Failed to disable sustained mode: " + e.getMessage());
        }
    }

    /**
     * Check if sustained mode is currently enabled.
     */
    public static boolean isSustainedModeEnabled() {
        return sustainedModeEnabled;
    }
}
