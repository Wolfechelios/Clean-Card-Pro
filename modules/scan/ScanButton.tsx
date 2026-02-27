import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';

export default function ScanButton() {
  const openCamera = async () => {
    const image = await Camera.getPhoto({
      quality: 100,
      resultType: CameraResultType.Base64,
      source: CameraSource.Camera
    });
    console.log(image);
  };

  return <button onClick={openCamera}>Scan Card</button>;
}