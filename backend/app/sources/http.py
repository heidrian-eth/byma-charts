import httpx

client = httpx.AsyncClient(
    timeout=httpx.Timeout(60.0),
    headers={"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) byma-charts/0.1"},
    follow_redirects=True,
)
