import AVFoundation
import UIKit

// Uses the existing Expo session. Configuration and KVO state are serialized on its queue.
final class BhomeCameraFocus: NSObject {
  private weak var view: CameraView?
  private var enabled = false
  private var device: AVCaptureDevice?
  private var observation: NSKeyValueObservation?
  private var subjectObserver: NSObjectProtocol?
  private var requestId = 0
  private var pending = false
  private var sawAdjustment = false
  private var timeout: DispatchWorkItem?
  private var point = CGPoint(x: -1, y: -1)
  private lazy var tap = UITapGestureRecognizer(target: self, action: #selector(tapped(_:)))

  init(view: CameraView) {
    self.view = view
    super.init()
    tap.cancelsTouchesInView = false
    tap.isEnabled = false
    view.addGestureRecognizer(tap)
  }

  func setEnabled(_ value: Bool) {
    tap.isEnabled = value
    guard let view else { return }
    view.sessionQueue.async { [weak self] in
      guard let self else { return }
      if self.enabled == value { return }
      self.enabled = value
      self.refreshOnQueue()
    }
  }

  func refresh() {
    view?.sessionQueue.async { [weak self] in self?.refreshOnQueue() }
  }

  private func refreshOnQueue() {
    cancel()
    observation?.invalidate()
    observation = nil
    if let subjectObserver { NotificationCenter.default.removeObserver(subjectObserver) }
    subjectObserver = nil
    device = nil
    guard enabled, let view,
      let input = view.session.inputs.compactMap({ $0 as? AVCaptureDeviceInput }).first else { return }
    let device = input.device
    self.device = device
    guard restoreContinuous(center: true) else { return }
    observeFocus(device)
    subjectObserver = NotificationCenter.default.addObserver(
      forName: AVCaptureDevice.subjectAreaDidChangeNotification, object: device, queue: nil
    ) { [weak self, weak device] _ in
      guard let self, let device, let view = self.view else { return }
      view.sessionQueue.async { [weak self] in
        guard let self, self.enabled, self.device === device, !self.pending else { return }
        self.restoreContinuous(center: true)
      }
    }
    report(supportsAf(device) ? "idle" : "unsupported")
  }

  private func observeFocus(_ device: AVCaptureDevice) {
    observation?.invalidate()
    let id = requestId
    observation = device.observe(\.isAdjustingFocus, options: [.new]) { [weak self, weak device] _, _ in
      guard let self, let device, let view = self.view else { return }
      let adjusting = device.isAdjustingFocus
      view.sessionQueue.async { [weak self] in
        guard let self, self.enabled, self.device === device, self.requestId == id else { return }
        if self.pending {
          if adjusting { self.sawAdjustment = true }
          if !adjusting && self.sawAdjustment {
            self.pending = false
            self.timeout?.cancel()
            self.timeout = nil
            // AVFoundation reports that adjustment ended, without a sharpness/success result.
            self.report("settled")
            self.restoreContinuous(center: false)
          }
        } else {
          self.point = CGPoint(x: -1, y: -1)
          self.report(adjusting ? "focusing" : "idle")
        }
      }
    }
  }

  @objc private func tapped(_ gesture: UITapGestureRecognizer) {
    guard let view, gesture.state == .ended else { return }
    let location = gesture.location(in: view)
    let bounds = view.bounds
    guard bounds.width > 0, bounds.height > 0, bounds.contains(location) else { return }
    // This conversion uses preview gravity/crop, rotation and connection mirroring.
    let cameraPoint = view.previewLayer.captureDevicePointConverted(fromLayerPoint: location)
    guard cameraPoint.x.isFinite, cameraPoint.y.isFinite,
      (0...1).contains(cameraPoint.x), (0...1).contains(cameraPoint.y) else { return }
    let displayPoint = CGPoint(x: location.x / bounds.width, y: location.y / bounds.height)
    view.sessionQueue.async { [weak self] in
      self?.focus(cameraPoint: cameraPoint, displayPoint: displayPoint)
    }
  }

  private func focus(cameraPoint: CGPoint, displayPoint: CGPoint) {
    guard enabled, let device else { return }
    cancel()
    point = displayPoint
    guard device.isFocusPointOfInterestSupported, supportsAf(device) else {
      report("unsupported")
      return
    }
    pending = true
    sawAdjustment = false
    observeFocus(device)
    do {
      try device.lockForConfiguration()
      device.focusPointOfInterest = cameraPoint
      device.focusMode = device.isFocusModeSupported(.autoFocus) ? .autoFocus : .continuousAutoFocus
      device.isSubjectAreaChangeMonitoringEnabled = true
      device.unlockForConfiguration()
      report("focusing")
      let id = requestId
      let deadline = DispatchWorkItem { [weak self] in
        guard let self, self.enabled, self.pending, self.requestId == id else { return }
        self.pending = false
        self.timeout = nil
        self.report("timeout")
        self.restoreContinuous(center: false)
      }
      timeout = deadline
      view?.sessionQueue.asyncAfter(deadline: .now() + 3, execute: deadline)
    } catch {
      pending = false
      report("failed")
    }
  }

  @discardableResult
  private func restoreContinuous(center: Bool) -> Bool {
    guard let device else { return false }
    do {
      try device.lockForConfiguration()
      defer { device.unlockForConfiguration() }
      if center && device.isFocusPointOfInterestSupported {
        device.focusPointOfInterest = CGPoint(x: 0.5, y: 0.5)
      }
      if device.isFocusModeSupported(.continuousAutoFocus) {
        device.focusMode = .continuousAutoFocus
      } else if device.isFocusModeSupported(.autoFocus) {
        device.focusMode = .autoFocus
      }
      device.isSubjectAreaChangeMonitoringEnabled = true
      return true
    } catch {
      report("failed")
      return false
    }
  }

  private func supportsAf(_ device: AVCaptureDevice) -> Bool {
    device.isFocusModeSupported(.continuousAutoFocus) || device.isFocusModeSupported(.autoFocus)
  }

  private func report(_ state: String) {
    guard enabled, let device, let view else { return }
    let event: [String: Any] = [
      "requestId": requestId, "state": state, "x": point.x, "y": point.y,
      "supportsAutoFocus": supportsAf(device),
      "supportsTapFocus": supportsAf(device) && device.isFocusPointOfInterestSupported,
      "supportsContinuousFocus": device.isFocusModeSupported(.continuousAutoFocus)
    ]
    DispatchQueue.main.async { [weak view] in view?.onBhomeFocusChanged(event) }
  }

  private func cancel() {
    requestId += 1
    pending = false
    sawAdjustment = false
    timeout?.cancel()
    timeout = nil
    point = CGPoint(x: -1, y: -1)
  }

  func stop() {
    tap.isEnabled = false
    view?.sessionQueue.async { [weak self] in
      guard let self else { return }
      self.enabled = false
      self.cancel()
      self.observation?.invalidate()
      self.observation = nil
      if let observer = self.subjectObserver { NotificationCenter.default.removeObserver(observer) }
      self.subjectObserver = nil
      self.device = nil
    }
  }

  deinit {
    observation?.invalidate()
    timeout?.cancel()
    if let observer = subjectObserver { NotificationCenter.default.removeObserver(observer) }
  }
}
