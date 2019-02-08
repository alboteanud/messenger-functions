// @ts-check
const functions = require('firebase-functions')
var admin = require("firebase-admin")
admin.initializeApp()

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

// listen for new Conversations and set up the User data
exports.onCreateConversation = functions.firestore.document('users/{uid}/conversations/{uidP}').onCreate((snap, context) => {
    const uidP = context.params.uidP
    const uid = context.params.uid

    return admin.firestore().doc(`users/${uidP}`).get()
        .then(doc => {
            if (doc.exists) {
                const user = doc.data()
                const palData = {
                    name: user.name,
                    uid: user.uid,
                    email: user.email,
                    photoUrl: user.photoUrl
                }
                // set up conversation User data
                return snap.ref.update(palData)
            } else {
                // doc.data() will be undefined in this case
                console.log("No such document!");
                return null
            }
        }).catch(error => console.log("Error getting document:", error))
})

exports.onNewSound = functions.storage.object().onFinalize(object => {
      if (!object.contentType.startsWith('audio/3gpp')) return null;

    const fileBucket = object.bucket; // The Storage bucket that contains the file.
    const filePath = object.name; // File path in the bucket.
    const metageneration = object.metageneration; // Number of times metadata has been generated. New objects have a value of 1.


    const pathArray = filePath.split('/')
    const uid = pathArray[2]
    const uidP = pathArray[3]

    const refConv = admin.firestore().doc(`users/${uid}/conversations/${uidP}`)
    const refConvPal = admin.firestore().doc(`users/${uidP}/conversations/${uid}`)

    return refConvPal.collection('settings').doc('blocked').get()
        .then(docBlk => {
            if (docBlk.exists) return null;     // the user is blocked

            const bucket = admin.storage().bucket(fileBucket)
            return bucket.file(filePath).getSignedUrl({ action: 'read', expires: '01-01-2091' })
        }).then(urls => {
            const now = Date.now()
            // update conversation status wits sound details
            const data = {
                soundUrl: urls[0],
                soundTime: now,
                timestampModif: now
            }

            notifyUserNewSound(uid, uidP, urls[0])

            const promises = []
            promises.push(refConv.set(data, { merge: true }))
            promises.push(refConvPal.set(data, { merge: true }))
            return Promise.all(promises)
        })
})

// updating PAL with new msg and Conversation update
exports.onNewTextMsg = functions.firestore.document('users/{uid}/conversations/{uidP}/messages/{msgId}').onCreate((snap, context) => {
    const message = snap.data()
    const uid = context.params.uid
    const uidP = context.params.uidP
    const msgId = context.params.msgId

    if (message.uid === uid) {  // making sure this user sent the msg

        const refConvPal = admin.firestore().doc(`users/${uidP}/conversations/${uid}`)
        const refMsg = refConvPal.collection("messages").doc(`${msgId}`)

        return refConvPal.collection('settings').doc('blocked').get().then(docBlk => {
            if (docBlk.exists) return null;     // the user is blocked so he cannot update pal data

            // update the conversation status with msg details
            const data = {
                msgText: message.msgText,
                msgAuthor: message.msgAuthor,
                msgTimestamp: message.msgTimestamp,
                timestampModif: message.timestampModif
            }

            const promises = []
            promises.push(refMsg.set(message, { merge: true }))
            promises.push(refConvPal.set(data, { merge: true }))
            return Promise.all(promises)
        })
    } else {  // this user just received a new msg from pal (above - if)

        return notifyUserNewTextMsg(uid, message)
    }
})

function notifyUserNewTextMsg(uid, message) {
    return admin.firestore().collection(`users/${uid}/tokens`).get().then(snapshot => {
        let tokens = []
        snapshot.forEach(doc => tokens.push(doc.id))

        if (tokens.length === 0) return null

        const payload = {
            data: {
                uidP: message.uid,
                msgText: message.msgText,
                msgAuthor: message.msgAuthor,
                photoUrl: message.photoUrl
            }
        }
        const options = { priority: "high" }
        return admin.messaging().sendToDevice(tokens, payload, options)
    })
}

function notifyUserNewSound(uid, uidP, soundUrl) {
    return admin.firestore().collection(`users/${uidP}/tokens`).get().then(snapshot => {
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


