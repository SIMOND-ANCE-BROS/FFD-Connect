/**
 * Entry point WEB uniquement - charge App.web sans aucun module mobile
 */
import { registerRootComponent } from "expo";
import App from "./App.web";

registerRootComponent(App);
