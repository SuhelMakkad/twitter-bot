const app = require("express")();
const cors = require("cors");
const http = require("http").Server(app);
const bodyParser = require("body-parser");

const axios = require("axios").default;
const TwitterApi = require("twitter-api-v2").default;

const { Configuration, OpenAIApi } = require("openai");
const admin = require("firebase-admin");
const serviceAccount = require("./serviceAccountKey.json");

require("dotenv").config();

const jsonParser = bodyParser.json();

app.use(cors({ origin: "*", optionsSuccessStatus: 200 }));
app.use(jsonParser);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const PORT = process.env.PORT || 4545;

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

app.get("/auth", async (req, res) => {
  const { url, codeVerifier, state } = twitterClient.generateOAuth2AuthLink(
    process.env.CALLBACK_URL,
    {
      scope: ["tweet.read", "tweet.write", "users.read", "offline.access"],
    }
  );

  await dbRef.update({ codeVerifier, state });
  res.redirect(url);
});

app.get("/callback", async (req, res) => {
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
      redirectUri: process.env.CALLBACK_URL,
    })
    .catch((e) => console.log(e));

  await dbRef.update({ accessToken, refreshToken });

  const { data } = await loggedClient.v2.me();

  res.send(data);
});

app.get("/tweet", async (req, res) => {
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

http.listen(PORT, () => {
  console.log("listening on :" + PORT);
});
