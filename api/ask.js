/**
 * NEXUS AI - FIREBASE ENGINE
 * Handles Database Synchronization and Authentication
 */

// Initialize Firebase with the provided config
const firebaseConfig = {
    apiKey: "AIzaSyBeiIUdVEv5kvJ6GFSzWZwFav8Nx3Mxhkg",
    authDomain: "code-editor-ai.firebaseapp.com",
    projectId: "code-editor-ai",
    storageBucket: "code-editor-ai.firebasestorage.app",
    messagingSenderId: "145185559673",
    appId: "1:145185559673:web:5646addc66bb365209b0a8",
    measurementId: "G-CYWKWQJGP0"
};

firebase.initializeApp(firebaseConfig);

const db = firebase.firestore();
const auth = firebase.auth();
const provider = new firebase.auth.GoogleAuthProvider();

/**
 * AUTHENTICATION
 */
async function signInWithGoogle() {
    try {
        const result = await auth.signInWithPopup(provider);
        console.log("User signed in:", result.user.displayName);
        loadUserFiles(); // Refresh files on login
        return result.user;
    } catch (error) {
        console.error("Auth Error:", error.message);
    }
}

function signOut() {
    auth.signOut().then(() => {
        window.location.reload();
    });
}

/**
 * FIRESTORE OPERATIONS
 */

// Save current code to Firestore
async function saveProjectToCloud(fileName, code, language) {
    const user = auth.currentUser;
    if (!user) {
        alert("Please login to save projects to the cloud.");
        return;
    }

    try {
        await db.collection("users").doc(user.uid).collection("projects").doc(fileName).set({
            name: fileName,
            content: code,
            language: language,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        
        console.log("Project saved to cloud successfully!");
        loadUserFiles(); 
    } catch (error) {
        console.error("Error saving project:", error);
    }
}

// Fetch all files for the current user
async function loadUserFiles() {
    const user = auth.currentUser;
    if (!user) return;

    const fileListContainer = document.getElementById('file-tree');
    
    try {
        const snapshot = await db.collection("users").doc(user.uid).collection("projects")
            .orderBy("updatedAt", "desc")
            .get();

        if (snapshot.empty) return;

        // Clear and rebuild file list
        fileListContainer.innerHTML = '';
        
        snapshot.forEach(doc => {
            const data = doc.data();
            const fileItem = document.createElement('div');
            fileItem.className = 'file-item';
            fileItem.innerHTML = `<i class="far fa-file-code"></i> <span>${data.name}</span>`;
            
            fileItem.onclick = () => {
                editor.setValue(data.content);
                document.getElementById('language-selector').value = data.language;
                monaco.editor.setModelLanguage(editor.getModel(), data.language);
            };

            fileListContainer.appendChild(fileItem);
        });
    } catch (error) {
        console.error("Error loading files:", error);
    }
}

/**
 * OBSERVERS & UI INTEGRATION
 */
auth.onAuthStateChanged((user) => {
    const loginBtn = document.getElementById('login-btn');
    if (user) {
        loginBtn.innerHTML = `<img src="${user.photoURL}" style="width:24px; border-radius:50%;">`;
        loginBtn.title = `Signed in as ${user.displayName}`;
        loadUserFiles();
    } else {
        loginBtn.innerHTML = `<i class="far fa-user-circle"></i>`;
        loginBtn.onclick = signInWithGoogle;
    }
});

// Intercept the Save button from script.js
document.getElementById('save-btn').addEventListener('click', () => {
    const fileName = prompt("Enter file name (e.g., main.js):", "index.js");
    if (fileName) {
        const code = editor.getValue();
        const lang = document.getElementById('language-selector').value;
        saveProjectToCloud(fileName, code, lang);
    }
});
          
