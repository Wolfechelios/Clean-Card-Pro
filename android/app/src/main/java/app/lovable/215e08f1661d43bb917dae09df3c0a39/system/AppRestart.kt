
package app.lovable.215e08f1661d43bb917dae09df3c0a39.system

import android.app.Activity
import android.content.Intent

object AppRestart {
    fun restart(activity: Activity) {
        val intent = activity.packageManager.getLaunchIntentForPackage(activity.packageName)
        intent?.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)
        activity.startActivity(intent)
        activity.finish()
        Runtime.getRuntime().exit(0)
    }
}
