/* MedPrice BD — about / data transparency page. */
(function () {
  var UI = window.MDB_UI;

  function renderAbout(ctx) {
    ctx.setMeta('About & data transparency — MedPrice BD',
      'Where the prices come from, how they are validated, what the verification statuses mean, and the limits of this catalogue.',
      '/about', null);
    ctx.root.innerHTML =
      '<div class="container doc" style="margin-top:32px">'
      + '<h1 style="font-size:24px">About this catalogue</h1>'
      + '<p class="muted" style="margin-top:10px;max-width:62ch">MedPrice BD is a local price catalogue for medicines sold in Bangladesh. It exists to answer one question clearly: what does a medicine cost today, and how recently was that price verified?</p>'

      + '<section class="section"><h2 style="font-size:17px">Where the data comes from</h2>'
      + '<p class="muted" style="margin-top:8px">Every record is collected from the public catalogue of <a href="https://www.arogga.com" target="_blank" rel="noopener nofollow">Arogga</a>, an online pharmacy in Bangladesh, through its public search API. The crawler runs locally from a single file (<code>scrape.js</code>), keeps request volume low, and stores the original API values verbatim — nothing is inferred or filled in. Product links on this site point back to the original listing.</p></section>'

      + '<section class="section"><h2 style="font-size:17px">What is stored</h2>'
      + '<p class="muted" style="margin-top:8px">Product identity (name, Bengali name, generic, manufacturer, strength, dosage form, category), packaging (base unit, sales unit, multipliers, strip and box sizes), customer-facing prices (regular and offer, each for base unit and sales unit, with quantity limits and the listed discount percentage), the original image URL, and verification metadata. Historical prices are appended on every re-crawl and never deleted.</p></section>'

      + '<section class="section"><h2 style="font-size:17px">Verification statuses</h2>'
      + '<div class="tbl-wrap"><table class="tbl"><tbody>'
      + '<tr><th scope="row"><span class="stamp"><span class="dot"></span>verified</span></th><td>All core fields, both price pairs, units and image present and consistent.</td></tr>'
      + '<tr><th scope="row"><span class="stamp warn"><span class="dot"></span>partial</span></th><td>Usable record with minor gaps — for example a missing image or generic name.</td></tr>'
      + '<tr><th scope="row"><span class="stamp bad"><span class="dot"></span>recheck</span></th><td>An anomaly was detected (all prices missing, offer above regular, or the API and the product page disagree). Both source values are preserved and flagged — never silently overwritten.</td></tr>'
      + '<tr><th scope="row"><span class="stamp bad"><span class="dot"></span>failed</span></th><td>Structurally broken record (no identifier or name). Kept out of listings.</td></tr>'
      + '</tbody></table></div></section>'

      + '<section class="section"><h2 style="font-size:17px">What this is not</h2>'
      + '<p class="muted" style="margin-top:8px">This is a price catalogue, not a pharmacy and not medical guidance. It does not diagnose, prescribe, recommend treatments or dosages, and it does not sell anything. Availability, stock and final checkout prices live on the source site. Prescription-required medicines are labelled as such from the source data; they require a licensed pharmacist and a valid prescription.</p></section>'

      + '<section class="section"><h2 style="font-size:17px">Freshness &amp; limits</h2>'
      + '<p class="muted" style="margin-top:8px">Prices move. A figure here is a snapshot verified on the date shown beside it; the dashboard page reports dataset-wide coverage, failed pages and gaps honestly — the system never claims complete coverage unless every discovered bucket was processed. The catalogue API limits each query to roughly 1,000 rows, so the crawler partitions the catalogue by category, dosage form and brand to reach every product.</p></section>'

      + '<section class="section"><h2 style="font-size:17px">Credits &amp; licences</h2>'
      + '<p class="muted" style="margin-top:8px">Design of this interface was reviewed with the <a href="https://github.com/dickwu/apple-design-skill" target="_blank" rel="noopener">Apple Design Skill</a> review method and the <a href="https://heydamir.design/unslop" target="_blank" rel="noopener">Unslop</a> workflow by Damir Sokolovsky, used under <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>. Product data © the respective manufacturers and the source platform, collected here for personal, local price reference.</p></section>'
      + '</div>';
  }

  MDB_ROUTER.add('/about', renderAbout);
})();
