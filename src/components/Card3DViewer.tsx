// components/Card3DViewer.tsx
"use client";

import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three-stdlib";
import { Button } from "@/components/ui/button";
import { RotateCcw, ZoomIn, ZoomOut, Pause, Play } from "lucide-react";

type Card3DViewerProps = {
  frontImageUrl: string;
  backImageUrl?: string;
  width?: number;
  height?: number;
};

const Card3DViewer: React.FC<Card3DViewerProps> = ({ frontImageUrl, backImageUrl, width = 400, height = 300 }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cardMeshRef = useRef<THREE.Mesh | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const [autoRotate, setAutoRotate] = useState(true);
  const autoRotateRef = useRef(autoRotate);

  // Keep ref in sync with state
  useEffect(() => {
    autoRotateRef.current = autoRotate;
  }, [autoRotate]);

  const handleZoomIn = () => {
    if (cameraRef.current) {
      cameraRef.current.position.z = Math.max(1.5, cameraRef.current.position.z - 0.5);
      controlsRef.current?.update();
    }
  };

  const handleZoomOut = () => {
    if (cameraRef.current) {
      cameraRef.current.position.z = Math.min(6, cameraRef.current.position.z + 0.5);
      controlsRef.current?.update();
    }
  };

  const handleReset = () => {
    if (cameraRef.current && cardMeshRef.current && controlsRef.current) {
      cameraRef.current.position.set(0, 0, 3);
      cardMeshRef.current.rotation.set(-0.1, 0.4, 0);
      controlsRef.current.target.set(0, 0, 0);
      controlsRef.current.update();
    }
  };

  useEffect(() => {
    if (!containerRef.current) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111111);

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.set(0, 0, 3);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);

    containerRef.current.innerHTML = "";
    containerRef.current.appendChild(renderer.domElement);

    const light = new THREE.DirectionalLight(0xffffff, 1.2);
    light.position.set(2, 2, 5);
    scene.add(light);

    const ambient = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambient);

    const cardWidth = 2.5;
    const cardHeight = 3.5;
    const cardDepth = 0.03;

    const geometry = new THREE.BoxGeometry(cardWidth, cardHeight, cardDepth);
    const loader = new THREE.TextureLoader();

    const materials: THREE.Material[] = [];

    const frontTexture = loader.load(frontImageUrl);
    frontTexture.colorSpace = THREE.SRGBColorSpace;

    const backTexture = backImageUrl ? loader.load(backImageUrl) : loader.load(frontImageUrl);
    backTexture.colorSpace = THREE.SRGBColorSpace;

    const sideMat = new THREE.MeshStandardMaterial({ color: 0x333333 });

    // Box faces order in three.js: [px, nx, py, ny, pz, nz]
    materials.push(sideMat); // px
    materials.push(sideMat); // nx
    materials.push(sideMat); // py
    materials.push(sideMat); // ny
    materials.push(new THREE.MeshStandardMaterial({ map: frontTexture })); // pz (front)
    materials.push(new THREE.MeshStandardMaterial({ map: backTexture })); // nz (back)

    const cardMesh = new THREE.Mesh(geometry, materials);
    scene.add(cardMesh);
    cardMeshRef.current = cardMesh;

    cardMesh.rotation.y = 0.4;
    cardMesh.rotation.x = -0.1;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.enableZoom = true;
    controls.minDistance = 1.5;
    controls.maxDistance = 6;
    controls.target.set(0, 0, 0);
    controls.update();
    controlsRef.current = controls;

    let animationFrameId: number;

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      
      // Auto-rotate the card
      if (autoRotateRef.current && cardMesh) {
        cardMesh.rotation.y += 0.005;
      }
      
      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      camera.aspect = rect.width / rect.height;
      camera.updateProjectionMatrix();
      renderer.setSize(rect.width, rect.height);
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      cancelAnimationFrame(animationFrameId);
      renderer.dispose();
      geometry.dispose();
      materials.forEach((m) => m.dispose && m.dispose());
      frontTexture.dispose();
      backTexture.dispose();
      if (containerRef.current) containerRef.current.innerHTML = "";
    };
  }, [frontImageUrl, backImageUrl, width, height]);

  return (
    <div className="relative" style={{ width: "100%", maxWidth: width }}>
      <div
        ref={containerRef}
        style={{
          width: "100%",
          height,
          borderRadius: 12,
          overflow: "hidden",
        }}
      />
      
      {/* Controls overlay */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-background/80 backdrop-blur-sm rounded-lg p-1 border border-border shadow-lg">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => setAutoRotate(!autoRotate)}
          title={autoRotate ? "Pause rotation" : "Resume rotation"}
        >
          {autoRotate ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={handleZoomIn}
          title="Zoom in"
        >
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={handleZoomOut}
          title="Zoom out"
        >
          <ZoomOut className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={handleReset}
          title="Reset view"
        >
          <RotateCcw className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
};

export default Card3DViewer;
