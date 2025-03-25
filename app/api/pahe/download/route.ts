import { client, redis } from "@/utils/redis"
import { ANIME, META } from "@consumet/extensions"
import puppeteer from "puppeteer"

async function fetchEpisodeDownloads(episodeId: string) {
  try {
    const browser = await puppeteer.launch({ headless: true })
    const page = await browser.newPage()
    const url = `https://animepahe.ru/play/${episodeId}`

    await page.goto(url, { waitUntil: "domcontentloaded" })
    await page.waitForSelector("#pickDownload > a", { timeout: 10000 })

    const downloads = await page.evaluate(() => {
      return Array.from(document.querySelectorAll("#pickDownload > a")).map(
        (el) => ({
          url: el.getAttribute("href"),
          quality: el.textContent?.trim(),
        })
      )
    })

    await browser.close()

    return downloads
  } catch (error) {
    return null
  }
}

export async function POST(request: Request) {
  try {
    const { anilistId, episodeNumber } = await request.json()
    if (!anilistId) {
      return new Response(
        JSON.stringify({
          message: "anilistId not provided!",
          error: "anilistId not provided!",
          episodeId: anilistId,
        }),
        { status: 400 }
      )
    }
    // ---------------------------
    // CHECK IF AVAILABLE IN REDIS
    // ---------------------------
    await redis.Connect()
    const cache_Key = `pahe:download:${anilistId}.${episodeNumber}`
    const cachedResponse = await client.get(cache_Key)
    if (cachedResponse) {
      return new Response(cachedResponse, { status: 200 })
    }

    const meta = new META.Anilist(new ANIME.AnimePahe())
    const info = await meta.fetchAnimeInfo(anilistId)
    if (!info) {
      return new Response(
        JSON.stringify({ message: "Could not fetch info!" }),
        {
          status: 400,
        }
      )
    }
    const episodes = info?.episodes
    const episode = episodes?.find((ep) => ep.number === episodeNumber)
    if (!episode) {
      return new Response(JSON.stringify({ message: "Episode not found!" }), {
        status: 404,
      })
    }
    const downloads = await fetchEpisodeDownloads(episode.id)
    if (!downloads) {
      return new Response(
        JSON.stringify({ message: "Download sources not found!" }),
        {
          status: 404,
        }
      )
    }

    // ---------------------
    // CACHE TO THE REDIS
    // ---------------------
    await client.set(cache_Key, JSON.stringify(downloads), { EX: 3600 })

    return new Response(JSON.stringify(downloads), { status: 200 })
  } catch (error) {
    let msg = `${(error as Error).message}`
    return new Response(
      JSON.stringify({
        message: "Internal Server Error!",
        error: msg,
      }),
      { status: 500 }
    )
  }
}
