// @ts-check
const functions = require('firebase-functions')
var admin = require("firebase-admin")
var serviceAccount = require("./serviceAccountKey.json")
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://my-project-1526043266253.firebaseio.com"
})

exports.onCreateUser = functions.auth.user().onCreate(firebaseUser => {
    const keywords = getKeywords(firebaseUser.displayName, firebaseUser.email)
    const uid = firebaseUser.uid
    const user = {
        name: firebaseUser.displayName,
        uid: uid,
        email: firebaseUser.email,
        photoUrl: firebaseUser.photoURL,
        keywords: keywords
    }
    return admin.firestore().doc(`users/${uid}`).set(user)
})

exports.onNewSound = functions.storage.object().onFinalize(object => {
    const fileBucket = object.bucket; // The Storage bucket that contains the file.
    const filePath = object.name; // File path in the bucket.
    const contentType = object.contentType; // File content type.
    const metageneration = object.metageneration; // Number of times metadata has been generated. New objects have a value of 1.

    if (!contentType.startsWith('video/')) return 0

    const pathArray = filePath.split('/')
    const uid = pathArray[2]
    const uidP = pathArray[3]

    const refConvPal = admin.firestore().doc(`users/${uidP}/conversations/${uid}`)
    return refConvPal.collection('settings').doc('blocked').get().then(docBlk => {
        if (docBlk.exists) return 0 // usr is blocked

        const bucket = admin.storage().bucket(fileBucket)
        const file = bucket.file(filePath)
        return file.getSignedUrl({
            action: 'read',
            expires: '01-01-2091'
        }).then(signedUrls => {
            return notifyUserNewSound(uid, uidP, signedUrls[0])
        })
    })
})

// updating PAL - new msg and Conversation update
exports.onNewTextMsg = functions.firestore.document('users/{uid}/conversations/{uidP}/messages/{msgId}').onCreate((snap, context) => {
    const message = snap.data()
    const uid = context.params.uid
    if (message.uid != uid) return 0

    const uidP = context.params.uidP
    const msgId = context.params.msgId
    const refConvPal = admin.firestore().doc(`users/${uidP}/conversations/${uid}`)
    const refMsg = refConvPal.collection("messages").doc(`${msgId}`)

    return refConvPal.collection('settings').doc('blocked').get().then(docBlk => {
        if (docBlk.exists) return 0 // usr is blocked

        const data = {
            msgText: message.msgText,
            msgAuthor: message.msgAuthor,
            msgTimestamp: message.msgTimestamp
        }

        const promises = []
        promises.push(refMsg.set(message, { merge: true }))
        promises.push(refConvPal.set(data, { merge: true }))
        return Promise.all(promises)
    })
})

// listen for new Conversations and set user data
exports.onCreateConversation = functions.firestore.document('users/{uid}/conversations/{uidP}').onCreate((snap, context) => {
    const uidP = context.params.uidP
    const uid = context.params.uid
    return admin.firestore().doc(`users/${uidP}`).get().then(doc => {
        const user = doc.data()
        const palData = {
            name: user.name,
            uid: user.uid,
            email: user.email,
            photoUrl: user.photoUrl,
        }
        // set conversation UserData
        return snap.ref.update(palData)
    })
})

function notifyUserNewSound(uid, uidP, soundUrl) {
    admin.firestore().collection(`users/${uidP}/tokens`).get().then(snapshot => {
        let tokens = []
        snapshot.forEach(doc => tokens.push(doc.id))
        const payload = {
            data: {
                uidP: uidP,
                uid: uid,
                soundUrl: soundUrl
            }
        }
        const options = { priority: "high", timeToLive: 120 }
        return admin.messaging().sendToDevice(tokens, payload, options)
    })
}

function getKeywords(displayName, email) {
    const set = new Set()
    if (email) {
        email = email.toLowerCase()
        addWordDeriv(email, set)
        const username = email.substring(0, email.lastIndexOf("@"))
        set.add(username)
    }

    if (displayName) {
        displayName = displayName.toLowerCase()
        addWordDeriv(displayName, set)
        const subNames = displayName.split(" ") // albo, albot, albote
        subNames.forEach(entry => addWordDeriv(entry, set))
    }
    const keywords = [...new Set(set)]
    return keywords
}

function addWordDeriv(word, set) {
    const minLength = 4
    if (word.length < minLength) return
    set.add(word)

    let endIndex = word.length
    if (endIndex > 7) endIndex = 7

    for (var i = minLength; i < endIndex; i++) {
        const substr = word.substring(0, i)
        set.add(substr)
    }
}

function cleanupTokens(response, tokens) {
    // For each notification we check if there was an error.
    const tokensDelete = []
    response.results.forEach((result, index) => {
        const error = result.error
        if (error) {
            if (error.code === 'messaging/invalid-registration-token' ||
                error.code === 'messaging/registration-token-not-registered') {
                const deleteTask = admin.firestore().collection('messages').doc(tokens[index]).delete();
                tokensDelete.push(deleteTask);
            }
        }
    })
    return Promise.all(tokensDelete);
}
