
package app.lovable.215e08f1661d43bb917dae09df3c0a39.performance

import android.content.Context
import com.getcapacitor.*

@CapacitorPlugin(name = "PerformanceMode")
class PerformanceModePlugin : Plugin() {
    private val PREFS = "performance_mode_prefs"
    private val KEY = "performance_mode_enabled"

    @PluginMethod
    fun setEnabled(call: PluginCall) {
        val enabled = call.getBoolean("enabled", false)
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        prefs.edit().putBoolean(KEY, enabled).apply()
        call.resolve()
    }

    @PluginMethod
    fun isEnabled(call: PluginCall) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val enabled = prefs.getBoolean(KEY, false)
        val ret = JSObject()
        ret.put("enabled", enabled)
        call.resolve(ret)
    }
}
