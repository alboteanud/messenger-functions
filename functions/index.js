// The Cloud Functions for Firebase SDK to create Cloud Functions and setup triggers.
const functions = require('firebase-functions');

// The Firebase Admin SDK to access the Firebase Realtime Database.
const admin = require('firebase-admin');
admin.initializeApp();

exports.notifyUser = functions.firestore.document('users/{uid}/conversations/{palId}/messages/{messageId}').onCreate((snap, context) => {
    const message = snap.data();
    console.log(`new message: ${message.text} `);

    if (message.uid === context.params.uid) return 0;

    return admin.firestore().collection(`users/${context.params.uid}/tokens`).get().then(snapshot => {

        let tokens = [];
        snapshot.forEach(doc => tokens.push(doc.id));
    

        if (tokens.length === 0) return 0;

        const payload = {
            data: {
                palId: `${context.params.palId}`,
                messageId: `${context.params.messageId}`,
                author: ` ${message.author}`,
                text: `${message.text}`,
                photoUrl: `${message.photoUrl}`,
                timestamp: `${message.timestamp}`
            }
        };

        const options = {
            priority: "high",
            timeToLive: 60
        };
        return admin.messaging().sendToDevice(tokens, payload, options);

    })
});

exports.onCreateUser = functions.auth.user().onCreate(firebaseUser => {
    console.log(`onCreateUser: ${firebaseUser.displayName}`);

    const keywords = getKeywords(firebaseUser.displayName, firebaseUser.email);

    const user = {
        name: firebaseUser.displayName,
        email: firebaseUser.email,
        photoUrl: firebaseUser.photoURL,
        uid: firebaseUser.uid,
        keywords: keywords
    };
    return admin.firestore().doc(`users/${firebaseUser.uid}`).set(user);
});

exports.onCreateConversation = functions.firestore.document('users/{uid}/conversations/{palId}').onCreate((snap, context) => {
// exports.onCreateConversation = functions.firestore.document('users/{uid}/conversations/{palId}/messages/{messageId}').onCreate((snap, context) => {
    console.log(`new conversation - palId: ${context.params.palId}`);

    return admin.firestore().doc(`users/${context.params.palId}`).get().then(snap => {

        const palData = {
            palName: snap.data().name,
            palId: snap.data().uid,
            palPhotoUrl: snap.data().photoUrl,
            palEmail: snap.data().email
        };

        return admin.firestore().doc(`users/${context.params.uid}/conversations/${context.params.palId}`).set(palData)
    })


});

function getKeywords(displayName, email) {
    const set = new Set();

    if (email) {
        email = email.toLowerCase()
        addDeriv(email, set)
        const username = getUserName(email)
        set.add(username)
    }

    if (displayName) {
        displayName = displayName.toLowerCase()
        addDeriv(displayName, set)
        const subNames = getWords(displayName) // albo, albot, albote
        subNames.forEach(entry => addDeriv(entry, set));
    }

    const keywords = [...new Set(set)];
    // console.log(keywords);
    return keywords
}

function addDeriv(word, set) {
    const minLength = 4
    if (word.length < minLength) return
    set.add(word)

    let endIndex = word.length
    if (endIndex > 7) endIndex = 7;

    for (i = minLength; i < endIndex; i++) {
        const substr = word.substring(0, i)
        set.add(substr)
    }
}

function getUserName(email) {
    const username = email.substring(0, email.lastIndexOf("@"));
    return username;

}

function getWords(str) {
    const words = str.split(" ");
    return words;
}