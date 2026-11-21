package expo.modules.camera

import android.annotation.SuppressLint
import android.hardware.camera2.CameraCharacteristics
import android.os.Handler
import android.os.Looper
import android.view.GestureDetector
import android.view.MotionEvent
import androidx.annotation.OptIn
import androidx.camera.camera2.interop.Camera2CameraInfo
import androidx.camera.camera2.interop.ExperimentalCamera2Interop
import androidx.camera.core.Camera
import androidx.camera.core.FocusMeteringAction
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import java.util.concurrent.TimeUnit

// Operates only on the CameraX instance already bound by ExpoCameraView.
internal class BhomeCameraFocus(
  private val preview: PreviewView,
  private val currentCamera: () -> Camera?,
  private val emit: (Map<String, Any>) -> Unit
) {
  private val handler = Handler(Looper.getMainLooper())
  private var enabled = false
  private var requestId = 0
  private var timeout: Runnable? = null
  private var supportsAf = false
  private var supportsContinuous = false
  private var supportsTap = false
  private var activeCamera: Camera? = null
  private val gestures = GestureDetector(preview.context, object : GestureDetector.SimpleOnGestureListener() {
    override fun onDown(event: MotionEvent) = enabled
    override fun onSingleTapUp(event: MotionEvent): Boolean {
      focus(event.x, event.y)
      preview.performClick()
      return true
    }
  })

  @SuppressLint("ClickableViewAccessibility")
  fun setEnabled(value: Boolean) {
    if (enabled == value) return
    enabled = value
    if (value) {
      preview.setOnTouchListener { _, event ->
        if (event.pointerCount > 1) false else gestures.onTouchEvent(event)
      }
      refresh()
    } else {
      preview.setOnTouchListener(null)
      cancel()
      activeCamera = null
    }
  }

  @OptIn(ExperimentalCamera2Interop::class)
  fun refresh() {
    if (!enabled) return
    cancel()
    val camera = currentCamera() ?: return
    activeCamera = camera
    val modes = try {
      Camera2CameraInfo.from(camera.cameraInfo)
        .getCameraCharacteristic(CameraCharacteristics.CONTROL_AF_AVAILABLE_MODES) ?: intArrayOf()
    } catch (_: Exception) {
      intArrayOf()
    }
    supportsAf = modes.any { it == CameraCharacteristics.CONTROL_AF_MODE_AUTO ||
      it == CameraCharacteristics.CONTROL_AF_MODE_CONTINUOUS_PICTURE }
    supportsContinuous = modes.contains(CameraCharacteristics.CONTROL_AF_MODE_CONTINUOUS_PICTURE)
    // A fixed-focus CameraX device may report a successful no-op. Check actual AF modes first.
    supportsTap = supportsAf && preview.width > 0 && preview.height > 0 &&
      camera.cameraInfo.isFocusMeteringSupported(action(preview.width / 2f, preview.height / 2f))
    report(if (supportsAf) "idle" else "unsupported")
  }

  private fun action(x: Float, y: Float): FocusMeteringAction {
    // PreviewView's factory accounts for scale/crop, display rotation, mirroring and sensor transform.
    val point = preview.meteringPointFactory.createPoint(x, y)
    return FocusMeteringAction.Builder(point, FocusMeteringAction.FLAG_AF)
      .setAutoCancelDuration(3, TimeUnit.SECONDS)
      .build()
  }

  internal fun focus(x: Float, y: Float) {
    if (!enabled || !x.isFinite() || !y.isFinite() || preview.width <= 0 || preview.height <= 0 ||
      x < 0 || y < 0 || x > preview.width || y > preview.height) return
    cancel()
    val camera = currentCamera() ?: return
    if (activeCamera !== camera) {
      refresh()
    }
    val id = requestId
    val normalizedX = x.toDouble() / preview.width
    val normalizedY = y.toDouble() / preview.height
    val focusAction = action(x, y)
    supportsTap = supportsAf && camera.cameraInfo.isFocusMeteringSupported(focusAction)
    if (!supportsTap) {
      report("unsupported", normalizedX, normalizedY)
      return
    }
    report("focusing", normalizedX, normalizedY)
    val deadline = Runnable {
      if (!enabled || requestId != id || currentCamera() !== camera) return@Runnable
      timeout = null
      // Invalidates the pending future before cancellation can complete it.
      requestId++
      camera.cameraControl.cancelFocusAndMetering()
      report("timeout", normalizedX, normalizedY)
    }
    timeout = deadline
    handler.postDelayed(deadline, 3500)
    try {
      val future = camera.cameraControl.startFocusAndMetering(focusAction)
      future.addListener({
        if (!enabled || requestId != id || currentCamera() !== camera) return@addListener
        handler.removeCallbacks(deadline)
        timeout = null
        val state = try {
          if (future.get().isFocusSuccessful) "focused" else "failed"
        } catch (_: Exception) {
          "failed"
        }
        report(state, normalizedX, normalizedY)
        // CameraX restores its default continuous-picture AF after cancellation.
        camera.cameraControl.cancelFocusAndMetering()
      }, ContextCompat.getMainExecutor(preview.context))
    } catch (_: Exception) {
      handler.removeCallbacks(deadline)
      timeout = null
      camera.cameraControl.cancelFocusAndMetering()
      report("failed", normalizedX, normalizedY)
    }
  }

  private fun report(state: String, x: Double = -1.0, y: Double = -1.0) {
    if (!enabled) return
    emit(mapOf("requestId" to requestId, "state" to state, "x" to x, "y" to y,
      "supportsAutoFocus" to supportsAf, "supportsTapFocus" to supportsTap,
      "supportsContinuousFocus" to supportsContinuous))
  }

  private fun cancel() {
    requestId++
    timeout?.let { handler.removeCallbacks(it) }
    timeout = null
    activeCamera?.cameraControl?.cancelFocusAndMetering()
  }

  fun dispose() {
    setEnabled(false)
  }
}
