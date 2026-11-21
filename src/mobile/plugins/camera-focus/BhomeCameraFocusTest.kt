package expo.modules.camera

import android.hardware.camera2.CameraCharacteristics
import android.os.Looper
import androidx.annotation.OptIn
import androidx.camera.camera2.interop.Camera2CameraInfo
import androidx.camera.camera2.interop.ExperimentalCamera2Interop
import androidx.camera.core.Camera
import androidx.camera.core.CameraInfo
import androidx.camera.core.FocusMeteringAction
import androidx.camera.core.FocusMeteringResult
import androidx.camera.core.SurfaceOrientedMeteringPointFactory
import androidx.camera.view.PreviewView
import com.google.common.util.concurrent.ListenableFuture
import io.mockk.*
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import java.time.Duration
import java.util.concurrent.Executor
import java.util.concurrent.TimeUnit

@RunWith(RobolectricTestRunner::class)
@OptIn(ExperimentalCamera2Interop::class)
class BhomeCameraFocusTest {
  private val preview = mockk<PreviewView>(relaxed = true)
  private val camera = mockk<Camera>(relaxed = true)
  private val info = mockk<CameraInfo>(relaxed = true)
  private val camera2 = mockk<Camera2CameraInfo>()
  private val events = mutableListOf<Map<String, Any>>()
  private val actions = mutableListOf<FocusMeteringAction>()
  private val futures = mutableListOf<PendingFocus>()
  private lateinit var focus: BhomeCameraFocus

  @Before fun setup() {
    every { preview.context } returns RuntimeEnvironment.getApplication()
    every { preview.width } returns 200
    every { preview.height } returns 100
    every { preview.meteringPointFactory } returns SurfaceOrientedMeteringPointFactory(200f, 100f)
    every { camera.cameraInfo } returns info
    every { info.isFocusMeteringSupported(any()) } returns true
    mockkObject(Camera2CameraInfo.Companion)
    every { Camera2CameraInfo.from(info) } returns camera2
    every { camera2.getCameraCharacteristic(CameraCharacteristics.CONTROL_AF_AVAILABLE_MODES) } returns intArrayOf(
      CameraCharacteristics.CONTROL_AF_MODE_AUTO, CameraCharacteristics.CONTROL_AF_MODE_CONTINUOUS_PICTURE
    )
    every { camera.cameraControl.startFocusAndMetering(capture(actions)) } answers {
      PendingFocus().also { futures.add(it) }
    }
    focus = BhomeCameraFocus(preview, { camera }) { events.add(it) }
    focus.setEnabled(true)
  }

  @After fun teardown() {
    if (::focus.isInitialized) focus.dispose()
    unmockkAll()
  }

  @Test fun mapsPreviewPointThroughTheProvidedNativeFactory() {
    focus.focus(50f, 75f)
    val point = actions.single().meteringPointsAf.single()
    assertEquals(0.25f, point.x, 0.0001f)
    assertEquals(0.75f, point.y, 0.0001f)
    assertEquals(0.25, events.last()["x"])
    assertEquals(0.75, events.last()["y"])
    assertEquals("focusing", events.last()["state"])
    assertEquals(true, events.first()["supportsContinuousFocus"])
  }

  @Test fun honorsTheNativeFactoryTransformInsteadOfReusingScreenCoordinates() {
    every { preview.meteringPointFactory } returns SurfaceOrientedMeteringPointFactory(400f, 200f)
    focus.focus(50f, 75f)
    val point = actions.single().meteringPointsAf.single()
    assertEquals(0.125f, point.x, 0.0001f)
    assertEquals(0.375f, point.y, 0.0001f)
  }

  @Test fun rejectsOutOfBoundsAndNonFinitePoints() {
    for ((x, y) in listOf(-1f to 10f, 201f to 10f, 10f to 101f, Float.NaN to 0f)) focus.focus(x, y)
    assertTrue(actions.isEmpty())
  }

  @Test fun reportsSuccessOnlyFromTheNativeFutureAndResumesDefaultAf() {
    focus.focus(50f, 50f)
    assertFalse(events.any { it["state"] == "focused" })
    futures.single().complete(true)
    shadowOf(Looper.getMainLooper()).idle()
    assertEquals("focused", events.last()["state"])
    verify(atLeast = 1) { camera.cameraControl.cancelFocusAndMetering() }
  }

  @Test fun reportsNativeFailure() {
    focus.focus(50f, 50f)
    futures.single().complete(false)
    shadowOf(Looper.getMainLooper()).idle()
    assertEquals("failed", events.last()["state"])
  }

  @Test fun ignoresAnOldResultAfterAnotherTap() {
    focus.focus(50f, 50f)
    focus.focus(100f, 50f)
    futures.first().complete(true)
    shadowOf(Looper.getMainLooper()).idle()
    assertEquals("focusing", events.last()["state"])
    futures.last().complete(false)
    shadowOf(Looper.getMainLooper()).idle()
    assertEquals("failed", events.last()["state"])
  }

  @Test fun timesOutAndDiscardsTheLateResult() {
    focus.focus(50f, 50f)
    shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(3501))
    assertEquals("timeout", events.last()["state"])
    futures.single().complete(true)
    shadowOf(Looper.getMainLooper()).idle()
    assertEquals("timeout", events.last()["state"])
  }

  @Test fun doesNotTreatAFixedFocusNoOpAsSuccess() {
    every { camera2.getCameraCharacteristic(CameraCharacteristics.CONTROL_AF_AVAILABLE_MODES) } returns intArrayOf(0)
    focus.refresh()
    focus.focus(50f, 50f)
    assertEquals("unsupported", events.last()["state"])
    assertTrue(actions.isEmpty())
  }

  @Test fun cancelsOnCloseOrLensRefresh() {
    focus.focus(50f, 50f)
    focus.refresh()
    futures.first().complete(true)
    shadowOf(Looper.getMainLooper()).idle()
    assertEquals("idle", events.last()["state"])
    focus.focus(50f, 50f)
    focus.dispose()
    val count = events.size
    futures.last().complete(true)
    shadowOf(Looper.getMainLooper()).idle()
    assertEquals(count, events.size)
  }

  private class PendingFocus : ListenableFuture<FocusMeteringResult> {
    private var result: FocusMeteringResult? = null
    private val listeners = mutableListOf<Pair<Runnable, Executor>>()
    fun complete(success: Boolean) {
      result = FocusMeteringResult.create(success)
      listeners.forEach { (listener, executor) -> executor.execute(listener) }
    }
    override fun addListener(listener: Runnable, executor: Executor) { listeners.add(listener to executor) }
    override fun get(): FocusMeteringResult = checkNotNull(result)
    override fun get(timeout: Long, unit: TimeUnit): FocusMeteringResult = get()
    override fun isDone() = result != null
    override fun isCancelled() = false
    override fun cancel(mayInterruptIfRunning: Boolean) = false
  }
}
