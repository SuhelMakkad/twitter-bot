const functions = require("firebase-functions");
const axios = require("axios").default;
const TwitterApi = require("twitter-api-v2").default;

const { Configuration, OpenAIApi } = require("openai");
const admin = require("firebase-admin");

admin.initializeApp();

const dbRef = admin.firestore().doc("tokens/demo");
const twitterClient = new TwitterApi({
  clientId: process.env.CLIENT_ID,
  clientSecret: process.env.CLIENT_SECRET,
});

const config = new Configuration({
  organization: process.env.OPENAI_ORG_ID,
  apiKey: process.env.OPENAI_SECRET,
});
const openai = new OpenAIApi(config);

const callbackURL = "http://127.0.0.1:5000/twitter-bot-1511/us-central1/callback";

exports.auth = functions.https.onRequest(async (req, res) => {
  const { url, codeVerifier, state } = twitterClient.generateOAuth2AuthLink(callbackURL, {
    scope: ["tweet.read", "tweet.write", "users.read", "offline.access"],
  });

  await dbRef.update({ codeVerifier, state });
  res.redirect(url);
});

exports.callback = functions.https.onRequest(async (req, res) => {
  const { state, code } = req.query;

  const dbSnapshot = await dbRef.get();
  const { codeVerifier, state: storedState } = dbSnapshot.data();

  if (state !== storedState) {
    return res.status(400).send(`Stored tokens do not match! ${state} ${storedState}`);
  }

  const {
    client: loggedClient,
    accessToken,
    refreshToken,
  } = await twitterClient
    .loginWithOAuth2({
      code,
      codeVerifier,
      redirectUri: callbackURL,
    })
    .catch((e) => console.log(e));

  await dbRef.update({ accessToken, refreshToken });

  const { data } = await loggedClient.v2.me();

  res.send(data);
});

exports.tweet = functions.https.onRequest(async (req, res) => {
  const { refreshToken } = (await dbRef.get()).data();
  const {
    client: refreshedClient,
    accessToken,
    refreshToken: newRefreshToken,
  } = await twitterClient.refreshOAuth2Token(refreshToken);

  await dbRef.update({ accessToken, refreshToken: newRefreshToken });

  const nextTweet = await openai.createCompletion("text-davinci-001", {
    prompt: "tweet sommthing cool about alien life",
    max_tokens: 64,
  });

  const { data } = await refreshedClient.v2.tweet(nextTweet.data.choices[0].text);
  dbRef.update({ lastTweetId: data.id });

  res.send(data);
});

exports.dailyJob = functions.pubsub.schedule("0 5 * * *").onRun(async (context) => {
  try {
    const data = (await axios.get("https://us-central1-twitter-bot-1511.cloudfunctions.net/tweet"))
      .data;
    console.log(`posted tweet with id: ${data.id}`);
  } catch (e) {
    console.log(e);
  }
});
