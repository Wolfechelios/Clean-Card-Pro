import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three-stdlib";

interface Card3DViewerProps {
  imageUrl: string;
  className?: string;
  autoRotate?: boolean;
  enableZoom?: boolean;
  enablePan?: boolean;
}

const Card3DViewer: React.FC<Card3DViewerProps> = ({
  imageUrl,
  className = "",
  autoRotate = true,
  enableZoom = true,
  enablePan = false,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const cardRef = useRef<THREE.Mesh | null>(null);
  const frameIdRef = useRef<number>(0);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    // Scene setup
    const scene = new THREE.Scene();
    scene.background = null; // Transparent background
    sceneRef.current = scene;

    // Camera setup
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.set(0, 0, 4);
    cameraRef.current = camera;

    // Renderer setup
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const mainLight = new THREE.DirectionalLight(0xffffff, 1);
    mainLight.position.set(5, 5, 5);
    mainLight.castShadow = true;
    scene.add(mainLight);

    const fillLight = new THREE.DirectionalLight(0x8b5cf6, 0.3);
    fillLight.position.set(-5, 0, 5);
    scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0x06b6d4, 0.2);
    rimLight.position.set(0, 5, -5);
    scene.add(rimLight);

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.enableZoom = enableZoom;
    controls.enablePan = enablePan;
    controls.autoRotate = autoRotate;
    controls.autoRotateSpeed = 2;
    controls.minDistance = 2;
    controls.maxDistance = 8;
    controls.maxPolarAngle = Math.PI / 1.5;
    controls.minPolarAngle = Math.PI / 4;
    controlsRef.current = controls;

    // Load card texture
    const textureLoader = new THREE.TextureLoader();
    textureLoader.load(
      imageUrl,
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = renderer.capabilities.getMaxAnisotropy();

        // Trading card aspect ratio (2.5" x 3.5" = 5:7)
        const cardWidth = 2.5;
        const cardHeight = 3.5;
        const cardDepth = 0.02;

        // Card geometry with rounded corners simulation
        const geometry = new THREE.BoxGeometry(cardWidth, cardHeight, cardDepth, 1, 1, 1);

        // Materials for front, back, and edges
        const frontMaterial = new THREE.MeshStandardMaterial({
          map: texture,
          roughness: 0.3,
          metalness: 0.1,
        });

        const backMaterial = new THREE.MeshStandardMaterial({
          color: 0x1a1a2e,
          roughness: 0.5,
          metalness: 0.2,
        });

        const edgeMaterial = new THREE.MeshStandardMaterial({
          color: 0xffffff,
          roughness: 0.3,
          metalness: 0.1,
        });

        const materials = [
          edgeMaterial, // right
          edgeMaterial, // left
          edgeMaterial, // top
          edgeMaterial, // bottom
          frontMaterial, // front
          backMaterial, // back
        ];

        const card = new THREE.Mesh(geometry, materials);
        card.castShadow = true;
        card.receiveShadow = true;
        scene.add(card);
        cardRef.current = card;

        setIsLoading(false);
      },
      undefined,
      (error) => {
        console.error("Error loading card texture:", error);
        setIsLoading(false);
      }
    );

    // Animation loop
    const animate = () => {
      frameIdRef.current = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    // Handle resize
    const handleResize = () => {
      if (!containerRef.current) return;
      const newWidth = containerRef.current.clientWidth;
      const newHeight = containerRef.current.clientHeight;
      camera.aspect = newWidth / newHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(newWidth, newHeight);
    };

    window.addEventListener("resize", handleResize);

    // Cleanup
    return () => {
      window.removeEventListener("resize", handleResize);
      cancelAnimationFrame(frameIdRef.current);
      controls.dispose();
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [imageUrl, autoRotate, enableZoom, enablePan]);

  return (
    <div
      ref={containerRef}
      className={`relative w-full h-full min-h-[300px] ${className}`}
    >
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-card/50 backdrop-blur-sm rounded-lg">
          <div className="flex flex-col items-center gap-2">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-muted-foreground">Loading 3D view...</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default Card3DViewer;
