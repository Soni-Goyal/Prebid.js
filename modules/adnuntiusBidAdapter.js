import { registerBidder } from '../src/adapters/bidderFactory.js';
import { BANNER } from '../src/mediaTypes.js';
import { isStr, deepAccess } from '../src/utils.js';
import { config } from '../src/config.js';
import { getStorageManager } from '../src/storageManager.js';

const BIDDER_CODE = 'adnuntius';
const ENDPOINT_URL = 'https://ads.adnuntius.delivery/i';
const GVLID = 855;

const checkSegment = function (segment) {
  if (isStr(segment)) return segment;
  if (segment.id) return segment.id
}

const getSegmentsFromOrtb = function (ortb2) {
  const userData = deepAccess(ortb2, 'user.data');
  let segments = [];
  if (userData) {
    userData.forEach(userdat => {
      if (userdat.segment) {
        segments.push(...userdat.segment.filter(checkSegment).map(checkSegment));
      }
    });
  }
  return segments
}

const handleMeta = function () {
  const storage = getStorageManager({gvlid: GVLID, bidderCode: BIDDER_CODE})
  let adnMeta = null
  if (storage.localStorageIsEnabled()) {
    adnMeta = JSON.parse(storage.getDataFromLocalStorage('adn.metaData'))
  }
  const meta = (adnMeta !== null) ? adnMeta.reduce((acc, cur) => { return { ...acc, [cur.key]: cur.value } }, {}) : {}
  return meta
}

const getUsi = function (meta, ortb2, bidderRequest) {
  let usi = (meta !== null && meta.usi) ? meta.usi : false;
  if (ortb2 && ortb2.user && ortb2.user.id) { usi = ortb2.user.id }
  return usi
}

export const spec = {
  code: BIDDER_CODE,
  gvlid: GVLID,
  supportedMediaTypes: [BANNER],
  isBidRequestValid: function (bid) {
    return !!(bid.bidId || (bid.params.member && bid.params.invCode));
  },

  buildRequests: function (validBidRequests, bidderRequest) {
    const networks = {};
    const bidRequests = {};
    const requests = [];
    const request = [];
    const ortb2 = config.getConfig('ortb2');
    const bidderConfig = config.getConfig();

    const adnMeta = handleMeta()
    const usi = getUsi(adnMeta, ortb2, bidderRequest)
    const segments = getSegmentsFromOrtb(ortb2);
    const tzo = new Date().getTimezoneOffset();
    const gdprApplies = deepAccess(bidderRequest, 'gdprConsent.gdprApplies');
    const consentString = deepAccess(bidderRequest, 'gdprConsent.consentString');

    request.push('tzo=' + tzo)
    request.push('format=json')
    if (gdprApplies !== undefined) request.push('consentString=' + consentString);
    if (segments.length > 0) request.push('segments=' + segments.join(','));
    if (usi) request.push('userId=' + usi);
    if (bidderConfig.useCookie === false) request.push('noCookies=true')
    for (var i = 0; i < validBidRequests.length; i++) {
      const bid = validBidRequests[i]
      const network = bid.params.network || 'network';
      const targeting = bid.params.targeting || {};

      bidRequests[network] = bidRequests[network] || [];
      bidRequests[network].push(bid);

      networks[network] = networks[network] || {};
      networks[network].adUnits = networks[network].adUnits || [];
      if (bidderRequest && bidderRequest.refererInfo) networks[network].context = bidderRequest.refererInfo.referer;
      if (adnMeta) networks[network].metaData = adnMeta;
      networks[network].adUnits.push({ ...targeting, auId: bid.params.auId, targetId: bid.bidId });
    }

    const networkKeys = Object.keys(networks)
    for (var j = 0; j < networkKeys.length; j++) {
      const network = networkKeys[j];
      requests.push({
        method: 'POST',
        url: ENDPOINT_URL + '?' + request.join('&'),
        data: JSON.stringify(networks[network]),
        bid: bidRequests[network]
      });
    }

    return requests;
  },

  interpretResponse: function (serverResponse, bidRequest) {
    const adUnits = serverResponse.body.adUnits;
    const bidResponsesById = adUnits.reduce((response, adUnit) => {
      if (adUnit.matchedAdCount >= 1) {
        const ad = adUnit.ads[0];
        const effectiveCpm = (ad.bid) ? ad.bid.amount * 1000 : 0;
        return {
          ...response,
          [adUnit.targetId]: {
            requestId: adUnit.targetId,
            cpm: effectiveCpm,
            width: Number(ad.creativeWidth),
            height: Number(ad.creativeHeight),
            creativeId: ad.creativeId,
            currency: (ad.bid) ? ad.bid.currency : 'EUR',
            dealId: ad.dealId || '',
            meta: {
              advertiserDomains: (ad.destinationUrls.destination) ? [ad.destinationUrls.destination.split('/')[2]] : []

            },
            netRevenue: false,
            ttl: 360,
            ad: adUnit.html
          }
        }
      } else return response
    }, {});

    const bidResponse = bidRequest.bid.map(bid => bid.bidId).reduce((request, adunitId) => {
      if (bidResponsesById[adunitId]) { request.push(bidResponsesById[adunitId]) }
      return request
    }, []);

    return bidResponse
  },

}
registerBidder(spec);
