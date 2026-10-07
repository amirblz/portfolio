// The site is static; this runs only so www.amirbalazade.ir redirects to the apex. Both hostnames
// are custom domains of this Worker, and wordy.cards allows framing from the apex only.

export default {
  fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname === "www.amirbalazade.ir") {
      url.hostname = "amirbalazade.ir";
      return Response.redirect(url.toString(), 301);
    }
    return env.ASSETS.fetch(request);
  },
};
