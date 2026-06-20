package app.lovable.performance;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Capacitor plugin to expose sustained performance mode to JavaScript.
 */
@CapacitorPlugin(name = "SustainedPerformance")
public class SustainedPerformancePlugin extends Plugin {

    @PluginMethod
    public void enable(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            PerformanceManager.enableSustained(getActivity());
            JSObject ret = new JSObject();
            ret.put("enabled", PerformanceManager.isSustainedModeEnabled());
            call.resolve(ret);
        });
    }

    @PluginMethod
    public void disable(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            PerformanceManager.disableSustained(getActivity());
            JSObject ret = new JSObject();
            ret.put("enabled", PerformanceManager.isSustainedModeEnabled());
            call.resolve(ret);
        });
    }

    @PluginMethod
    public void isEnabled(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("enabled", PerformanceManager.isSustainedModeEnabled());
        call.resolve(ret);
    }
}
