
package app.lovable.215e08f1661d43bb917dae09df3c0a39.storage

import android.content.Context
import java.io.File

object ImageStorage {
    fun getImagesDir(context: Context): File {
        val dir = File(context.filesDir, "images")
        if (!dir.exists()) dir.mkdirs()
        return dir
    }
}
