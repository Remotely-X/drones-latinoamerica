(function () {
  class WebcamService {
    constructor(video) {
      this.video = video;
      this.stream = null;
      this.devices = [];
      this.deviceIndex = 0;
    }

    async listCameras() {
      if (!navigator.mediaDevices?.enumerateDevices) {
        return [];
      }

      const devices = await navigator.mediaDevices.enumerateDevices();
      this.devices = devices.filter((device) => device.kind === "videoinput");
      return this.devices;
    }

    async start(deviceId) {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Tu navegador no permite acceder a la cámara.");
      }

      this.stop();
      const constraints = {
        video: deviceId
          ? { deviceId: { exact: deviceId } }
          : { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      };

      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.video.srcObject = this.stream;
      await this.video.play();
      await this.listCameras();
      return this.stream;
    }

    async switchCamera() {
      await this.listCameras();
      if (this.devices.length < 2) {
        return this.stream;
      }

      this.deviceIndex = (this.deviceIndex + 1) % this.devices.length;
      return this.start(this.devices[this.deviceIndex].deviceId);
    }

    stop() {
      if (this.stream) {
        this.stream.getTracks().forEach((track) => track.stop());
      }
      this.stream = null;
      if (this.video) {
        this.video.srcObject = null;
      }
    }
  }

  window.WebcamService = WebcamService;
})();
