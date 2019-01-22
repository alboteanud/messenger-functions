function getKeywords(email, displayName){
    let set = new Set();
    
    if(email){
        email = email.toLowerCase() 
        addDeriv(email, set)   
        const username = getUserName(email)
        set.add(username)   
    }
    
    if(displayName){
        displayName = displayName.toLowerCase() 
        addDeriv(displayName, set)
        const subNames = getWords(displayName)       // albo, albot, albote
        subNames.forEach( entry => addDeriv(entry, set)); 
    }

    const keywords = [...new Set(set)];
    console.log(keywords);
    
    return keywords
}

getKeywords("alboteanud@gmail.com", "dan cristian alboteanu");

function addDeriv(word, set) {
    const minLength = 4
    if (word.length < minLength) return
    
    set.add(word)
    
    var endIndex = word.length
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