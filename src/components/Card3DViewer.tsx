// components/Card3DViewer.tsx
"use client";

import React, { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three-stdlib";

type Card3DViewerProps = {
  frontImageUrl: string;
  backImageUrl?: string; // optional for now
  width?: number;
  height?: number;
};

const Card3DViewer: React.FC<Card3DViewerProps> = ({ frontImageUrl, backImageUrl, width = 400, height = 300 }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111111);

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.set(0, 0, 3);

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

    const backTexture = backImageUrl ? loader.load(backImageUrl) : loader.load(frontImageUrl); // fallback

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

    cardMesh.rotation.y = 0.4;
    cardMesh.rotation.x = -0.1;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.enableZoom = true;
    controls.target.set(0, 0, 0);
    controls.update();

    let animationFrameId: number;

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
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
    <div
      ref={containerRef}
      style={{
        width: "100%",
        maxWidth: width,
        height,
        borderRadius: 12,
        overflow: "hidden",
      }}
    />
  );
};

export default Card3DViewer;
