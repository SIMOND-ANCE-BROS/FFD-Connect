/**
 * Pour EAS Build lancé depuis la racine : réexporte la config Metro du client.
 * Le client utilise __dirname = apps/client, donc la config reste valide.
 */
module.exports = require('./apps/client/metro.config.js');
