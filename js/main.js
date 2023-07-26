//モデルの位置
const posX = 0;
const posY = 0;
const posZ = 0.5;
//モデルのサイズ
const scale = 1;

//黒枠の幅（ジェネレータのPatternRatioと合わせる）
const patternRatio = 0.9;
//マーカーを検出するフレームレート
const maxDetectionRate = 30;

const getURLParam = (name, url) => {
	if(!url){ url = window.location.href; }

	name = name.replace(/[\[\]]/g, "\\$&");
	let regex = new RegExp("[?&]" + name + "(=([^&#]*)|&|#|$)"),
	results = regex.exec(url);

	if(!results){ return null; }
	if(!results[2]){ return ''; }

	return decodeURIComponent(results[2].replace(/\+/g, " "));
}
//GETのstandに1が指定されているならQRに対して垂直に立たせる
//e.g. https://hogehoge?stand=1
const stand = (getURLParam("stand") == 1) ? true : false; 

let renderer, scene, camera;
let arToolkitSource, arToolkitContext;
let markerGroup, markerScene;
let smoothedControls;
let mixer;

const clock = new THREE.Clock();
const stats = new Stats();
document.body.appendChild(stats.dom);
const loading = document.getElementById("loading");

//THREEのレンダラの初期化
const initRenderer = async () => {
	//z-fighting対策でlogarithmicDepthBufferを指定
	renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, logarithmicDepthBuffer: true });
	renderer.gammaOutput = true;
	renderer.setClearColor(new THREE.Color(0xffffff), 0);
	renderer.setSize(window.innerWidth, window.innerHeight);
	renderer.domElement.style.position = "absolute";
	renderer.domElement.style.top = "0px";
	renderer.domElement.style.left = "0px";
	document.body.appendChild(renderer.domElement);
}
//THREEのシーンの初期化
const initScene = async () => {
	scene = new THREE.Scene();

	camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 1000, 10000);
	scene.add(camera);

	const light = new THREE.AmbientLight(0xffffff, 1.0);
	scene.add(light);

	const artoolkitProfile = new THREEx.ArToolkitProfile();
	artoolkitProfile.sourceWebcam();

	arToolkitSource = new THREEx.ArToolkitSource(artoolkitProfile.sourceParameters);
	arToolkitSource.init(onReady = () => { resize() });

	artoolkitProfile.contextParameters.patternRatio = patternRatio;
	artoolkitProfile.contextParameters.cameraParametersUrl = "assets/camera_para.dat";
	//artoolkitProfile.contextParameters.detectionMode = "color_and_matrix";
	artoolkitProfile.contextParameters.maxDetectionRate = maxDetectionRate;

	arToolkitContext = new THREEx.ArToolkitContext(artoolkitProfile.contextParameters);
	arToolkitContext.init(onCompleted = () => {
		camera.projectionMatrix.copy(arToolkitContext.getProjectionMatrix());
	});

	window.onresize = resize;
	resize();

	markerGroup = new THREE.Group();
	scene.add(markerGroup);

	const markerControls = new THREEx.ArMarkerControls(arToolkitContext, markerGroup, {
		type : "pattern",
		patternUrl : "assets/marker.patt",
	});

	const smoothedGroup = new THREE.Group();
	scene.add(smoothedGroup);

	smoothedControls = new THREEx.ArSmoothedControls(smoothedGroup);

	markerScene = new THREE.Scene();
	smoothedGroup.add(markerScene);

	//VRMモデルの読み込み
	const result = await loadModel();

	return result;
}

//ブラウザのリサイズ時の処理
const resize = () => {
	arToolkitSource.onResizeElement();
	arToolkitSource.copyElementSizeTo(renderer.domElement);
	if(arToolkitContext.arController !== null){
		arToolkitSource.copyElementSizeTo(arToolkitContext.arController.canvas);
	}
}

//VRMモデルの読み込み
const loadModel = async () => {
	//vrmファイルの読み込み
	const vrmLoader = new THREE.VRMLoader();
	const result = await new Promise(resolve => {
		vrmLoader.load("assets/VRoid.vrm", (vrm) => {
			vrm.scene.position.x = posX;
			vrm.scene.position.y = posY;
			vrm.scene.position.z = posZ;
			vrm.scene.scale.x = scale;
			vrm.scene.scale.y = scale;
			vrm.scene.scale.z = scale;
			vrm.scene.rotation.x = 0.0;
			vrm.scene.rotation.y = Math.PI;
			vrm.scene.rotation.z = 0.0;
			if(!stand){ vrm.scene.rotation.x = -Math.PI / 2.0; }

			markerScene.add(vrm.scene);

			// VRMLoader doesn't support VRM Unlit extension yet so
			// converting all materials to MeshBasicMaterial here as workaround so far.
			vrm.scene.traverse((object) => {
				if(!object.material){ return; }

				if(Array.isArray(object.material)){
					for(let i = 0, il = object.material.length; i < il; i ++){
						const material = new THREE.MeshBasicMaterial();
						THREE.Material.prototype.copy.call(material, object.material[i]);
						material.color.copy(object.material[i].color);
						material.map = object.material[i].map;
						material.lights = false;
						material.skinning = object.material[i].skinning;
						material.morphTargets = object.material[i].morphTargets;
						material.morphNormals = object.material[i].morphNormals;
						object.material[i] = material;
					}
				}else{
					const material = new THREE.MeshBasicMaterial();
					THREE.Material.prototype.copy.call(material, object.material);
					material.color.copy(object.material.color);
					material.map = object.material.map;
					material.lights = false;
					material.skinning = object.material.skinning;
					material.morphTargets = object.material.morphTargets;
					material.morphNormals = object.material.morphNormals;
					object.material = material;
				}
			});

			mixer = new THREE.AnimationMixer(vrm.scene);

			//別のgltfからモーションを借用。本来は不要な処理
			//http://examples.claygl.xyz/examples/basicModelAnimation.html
			const boneLoader = new THREE.GLTFLoader();
			boneLoader.load("assets/motion.gltf", function(bone){
				const animations = bone.animations;
				if(animations && animations.length){
					for(let animation of animations){
						correctBoneName(animation.tracks);
						correctCoordinate(animation.tracks);
						mixer.clipAction(animation).play();
					}
				}
			});

			return resolve(vrm.scene);
		});
	});

	return result;
}



//初期化処理
const init = async () => {
	let resRenderer = initRenderer();
	let resScene = initScene();

	//レンダラ、シーンの初期化が済んでいるか
	await Promise.all([resRenderer, resScene]);
	loading.style.display = "none";

	//更新処理の開始
	requestAnimationFrame(update);
}

//更新処理
const update = async () => {
	requestAnimationFrame(update);

	if(arToolkitSource.ready === false){ return; }
	arToolkitContext.update(arToolkitSource.domElement);

	smoothedControls.update(markerGroup);

	let delta = clock.getDelta();
	if(mixer){ mixer.update(delta); }

	renderer.render(scene, camera);
	stats.update();
}

//初期化処理の開始
init();
