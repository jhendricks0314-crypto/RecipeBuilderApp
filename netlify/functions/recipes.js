// Recipes CRUD — all recipes are stored in Blobs and scoped to the profile.
//   GET    /api/recipes                 -> list this profile's recipes
//   GET    /api/recipes?id=rec_...      -> one recipe
//   POST   /api/recipes                 { recipe | recipes:[] }  -> save
//   PUT    /api/recipes                 { recipe }               -> update (steps, comments, rating, photos)
//   DELETE /api/recipes?id=rec_...      -> delete
import { getUser, ok, bad, unauth, forbidden } from './_shared/auth.js'
import { stores, readJSON, writeJSON, listAll, id } from './_shared/blobs.js'
import { logError, logEvent } from './_shared/log.js'

export default async (req) => {
  const user = await getUser(req)
  if (!user) return unauth()
  if (!user.profileId) return bad('Create a profile first.')
  const url = new URL(req.url)

  try {
    if (req.method === 'GET') {
      const rid = url.searchParams.get('id')
      if (rid) {
        const r = await readJSON(stores.recipes(), rid)
        if (!r || r.profileId !== user.profileId) return forbidden()
        return ok({ recipe: r })
      }
      const all = await listAll(stores.recipes())
      const mine = all
        .filter((r) => r.profileId === user.profileId)
        .sort((a, b) => (b.savedAt || b.generatedAt || '').localeCompare(a.savedAt || a.generatedAt || ''))
      return ok({ recipes: mine })
    }

    if (req.method === 'POST') {
      const body = await req.json()
      const incoming = body.recipes || (body.recipe ? [body.recipe] : [])
      if (!incoming.length) return bad('No recipe to save.')
      const now = new Date().toISOString()
      const saved = []
      for (const r of incoming) {
        const rid = r.id && r.id.startsWith('rec_') ? r.id : id('rec_')
        const rec = { ...r, id: rid, profileId: user.profileId, savedAt: r.savedAt || now }
        await writeJSON(stores.recipes(), rid, rec)
        saved.push(rec)
      }
      await logEvent({ req, user, action: 'recipe-save', message: `Saved ${saved.length} recipe(s)` })
      return ok({ recipes: saved })
    }

    if (req.method === 'PUT') {
      const { recipe } = await req.json()
      if (!recipe?.id) return bad('Missing recipe id.')
      const existing = await readJSON(stores.recipes(), recipe.id)
      if (!existing || existing.profileId !== user.profileId) return forbidden()
      const merged = { ...existing, ...recipe, profileId: user.profileId, updatedAt: new Date().toISOString() }
      await writeJSON(stores.recipes(), recipe.id, merged)
      return ok({ recipe: merged })
    }

    if (req.method === 'DELETE') {
      const rid = url.searchParams.get('id')
      const existing = await readJSON(stores.recipes(), rid)
      if (!existing || existing.profileId !== user.profileId) return forbidden()
      await stores.recipes().delete(rid)
      return ok({ deleted: true })
    }

    return bad('Unsupported method.', 405)
  } catch (error) {
    await logError({ req, user, action: `recipes:${req.method}`, error })
    return bad('Something went wrong with your recipes.', 500)
  }
}
