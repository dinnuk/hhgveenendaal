export default {
    async fetch(request) {
        return new Response("Hello from HHG Veenendaal Worker!", {
            headers: { "Content-Type": "text/plain" },
        });
    },
};
