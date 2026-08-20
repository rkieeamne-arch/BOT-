import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc } from "firebase/firestore";
import fs from "fs";

const configPath = "firebase-applet-config.json";
let firebaseConfig;
try {
  const configFile = fs.readFileSync(configPath, "utf-8");
  firebaseConfig = JSON.parse(configFile);
} catch (error) {
  console.error("Error reading config", error);
  process.exit(1);
}

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function run() {
  const ref = doc(db, "guilds", "1028328224595861504");
  const d = await getDoc(ref);
  console.log(JSON.stringify(d.data().moderationRoles, null, 2));
  process.exit(0);
}
run();
