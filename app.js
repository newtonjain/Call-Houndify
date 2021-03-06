//"houndify" module contains both client-side ("HoundifyClient") and server-side ("HoundifyExpress") parts of SDK
var Houndify = require('houndify');
var wav = require('wav');
var fs = require('fs');
var path = require('path');
var express = require('express');
var https = require('https');
var bodyParser = require('body-parser');
const MessagingResponse = require('twilio').twiml.MessagingResponse;
const VoiceResponse = require('twilio').twiml.VoiceResponse;
var request = require('request');

//parse arguments
var argv = require('minimist')(process.argv.slice(2));

//config file
var configFile = argv.config || 'config';
var config = require(path.join(__dirname, configFile));

//express app
var app = express();
var port = process.env.PORT || config.port || 8446;

//REQUEST INFO JSON
//see https://houndify.com/reference/RequestInfo
var requestInfo = {
    UserID: "test_user",
    Latitude: 37.388309,
    Longitude: -121.973968
}

// To scale the application across multiple users, create a hashmap to track conversational state for each unique user.
// Use user's phone number as a unique key. 
var conversationState;

if (config.https) {
    //ssl credentials
    var privateKey = fs.readFileSync(config.sslKeyFile);
    var certificate = fs.readFileSync(config.sslCrtFile);
    var credentials = {
        key: privateKey,
        cert: certificate
    };
    //https server
    var httpsServer = https.createServer(credentials, app);
    httpsServer.listen(port, function() {
        console.log("HTTPS server running on port", port);
        console.log("Open https://localhost:" + port, "in the browser to view the Web SDK demo");
    });
} else {
    app.listen(port, function() {
        console.log("HTTP server running on port", port);
        console.log("Open http://localhost:" + port, "in the browser to view the Web SDK demo");
    });
}

app.use(bodyParser());

app.get('/', function(req, res) {
    res.send("Hello World");
})


//Send the query from arguments with request info object
app.post('/sms', (req, res) => {
    const twiml = new MessagingResponse();
    var query = req.body.Body;
    console.log('here is the REQ', req.body.From);


    //Initialize TextRequest
    var textRequest = new Houndify.TextRequest({
        clientId: config.clientId,
        clientKey: config.clientKey,
        query: query,
        requestInfo: requestInfo,
        conversationState: conversationState,
        onResponse: function(response, info) {
            console.log("HERE IS THE TEXT RESPONSE", response);
            twiml.message(response.AllResults[0].SpokenResponse);

            res.writeHead(200, {
                'Content-Type': 'text/xml'
            });
            res.end(twiml.toString());
            //get current conversation state for a user and save it somewhere
            //you can then re-set it later, before sending another request for that user
            conversationState = response.AllResults[0].ConversationState;
        },
        onError: function(err, info) {
            console.log(err);
        }
    });
});

// Create a route that will handle Twilio webhook requests, sent as an
// HTTP POST to /voice in our application
app.post('/voice', (request, response) => {
    // Get information about the incoming call, like the city associated
    // with the phone number (if Twilio can discover it)
    // Use the Twilio Node.js SDK to build an XML response
    const twiml = new VoiceResponse();
    twiml.say({
            voice: 'alice'
        },
        `Welcome to Call the Web powered by Houndify. How can I help you today?`
    );
    twiml.record({
        action: ' [ADD YOUR NGROK OR CLOUD SERVICE PROVIDER URL HERE]/userquestion',
        timeout: 1,
    });
    // Render the response as XML in reply to the webhook request
    response.type('text/xml');
    response.send(twiml.toString());
});


//Once the user asks his first question, TwiML action will trigger this route. 
app.post('/userquestion', function(req, res) {

    var twiml = new VoiceResponse();
    twiml.say({
            voice: 'alice'
        },
        `Thanks for your question. Fetching a response now.`
    );

    var reader = new wav.Reader();
    var audioFile = req.body.RecordingUrl + ".wav";
    var myClientVoice;

    //Read test wave and stream it to Houndify backend
    reader.on('format', function(format) {
        myClientVoice = new Houndify.VoiceRequest({
            clientId: config.clientId,
            clientKey: config.clientKey,
            requestInfo: requestInfo,
            sampleRate: 8000,
            enableVAD: true,
            onversationState: conversationState,
            onResponse: function(response, info) {
                console.log("HERE IS THE VOICE RESPONSE", response);
                if (response.AllResults[0].CommandKind == 'NoResultCommand') {
                    twiml.say({
                        voice: 'alice'
                    }, 'I was not able to find an answer for that. Do you have another question that I could help you with?');
                    res.type('text/xml');
                    res.send(twiml.toString());
                } else {
                    twiml.say({
                        voice: 'alice'
                    }, response.AllResults[0].SpokenResponseLong);

                    // Keep on looping on this route as long as user has questions
                    twiml.say({
                        voice: 'alice'
                    }, 'Do you have another question that I could help you with?');
                    twiml.record({
                        action: ' [ADD YOUR NGROK OR CLOUD SERVICE PROVIDER URL HERE]/userquestion'
                    });
                    res.type('text/xml');
                    res.send(twiml.toString());
                }
                //get current conversation state for a user and save it somewhere
                //you can then re-set it later, before sending another request for that user
                conversationState = response.AllResults[0].ConversationState;
            },

            onTranscriptionUpdate: function(trObj) {
                console.log("Partial Transcript:", trObj.PartialTranscript);
            },

            onError: function(err, info) {
                console.log(err);
            }

        });
    });

    reader.on('data', function(chunk) {
        var arrayBuffer = new Uint8Array(chunk).buffer;
        var view = new Int16Array(arrayBuffer);
        myClientVoice.write(view);
    });

    reader.on('end', function() {
        myClientVoice.end();
    });

    setTimeout(function() {
        request(audioFile).pipe(reader);
    }, 500)
})