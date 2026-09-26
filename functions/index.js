const functions = require("firebase-functions");
const cors = require("cors")({ origin: true });
const axios = require("axios");

exports.getBookingIcal = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      const targetUrl = req.query.url;
      if (!targetUrl) {
        return res.status(400).send("URL iCal manquante.");
      }

      const response = await axios.get(targetUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          "Accept": "text/calendar, text/plain, */*"
        },
        timeout: 10000
      });

      res.set("Content-Type", "text/calendar; charset=utf-8");
      return res.status(200).send(response.data);
    } catch (error) {
      console.error("Erreur iCal :", error.message);
      return res.status(500).send("Erreur lors de la récupération du calendrier Booking.");
    }
  });
});