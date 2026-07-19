"""WeCom (企业微信) API client — self-built app flow.

Self-built app: corp_id + secret → access_token → API calls.
"""
import time as _time
import httpx
from typing import Optional

from backend.config import settings


class WeComClient:
    """Async client for WeCom (企业微信) APIs.

    Uses CorpID + Secret to obtain an access_token (valid 7200s),
    then calls checkin and approval APIs.
    """

    BASE_URL = "https://qyapi.weixin.qq.com/cgi-bin"

    def __init__(self):
        self._corp_id = settings.WECOM_CORP_ID
        self._secret = settings.WECOM_SECRET
        self._access_token: Optional[str] = None
        self._token_expires_at: float = 0.0
        self._client: Optional[httpx.AsyncClient] = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=30.0)
        return self._client

    async def _ensure_token(self) -> str:
        """Get a valid access_token, refreshing if expired or not yet obtained."""
        if self._access_token and _time.time() < self._token_expires_at - 60:
            return self._access_token
        await self.authenticate()
        return self._access_token

    async def authenticate(self) -> str:
        """Obtain or refresh the WeCom access_token."""
        client = await self._get_client()
        url = f"{self.BASE_URL}/gettoken"
        params = {"corpid": self._corp_id, "corpsecret": self._secret}
        resp = await client.get(url, params=params)
        resp.raise_for_status()
        body = resp.json()
        if body.get("errcode") != 0:
            raise RuntimeError(f"WeCom auth failed: {body.get('errmsg', 'unknown')}")
        self._access_token = body["access_token"]
        self._token_expires_at = _time.time() + body.get("expires_in", 7200)
        return self._access_token

    async def _post(self, path: str, json_data: dict) -> dict:
        """POST to WeCom API with access_token, retry once on token expiry."""
        for attempt in range(2):
            token = await self._ensure_token()
            client = await self._get_client()
            url = f"{self.BASE_URL}/{path}"
            params = {"access_token": token}
            resp = await client.post(url, params=params, json=json_data)
            resp.raise_for_status()
            body = resp.json()
            errcode = body.get("errcode", 0)
            if errcode == 0:
                return body
            if errcode in (40014, 42001, 42007) and attempt == 0:
                self._access_token = None
                continue
            raise RuntimeError(f"WeCom API error [{errcode}]: {body.get('errmsg', 'unknown')}")
        raise RuntimeError("WeCom API retry exhausted")

    async def get_checkin_data(
        self, start_time: int, end_time: int, user_list: Optional[list] = None
    ) -> list:
        """Fetch checkin (打卡) data for a date range."""
        body = {
            "opencheckindatatype": 3,
            "starttime": start_time,
            "endtime": end_time,
            "useridlist": user_list or [],
        }
        data = await self._post("checkin/getcheckindata", body)
        return data.get("checkindata", [])

    async def get_user_list(self, department_id: int = 1) -> list:
        """Fetch all users in a department (recursive).

        GET /cgi-bin/user/list?access_token=TOKEN&department_id=ID&fetch_child=1
        Returns list of {userid, name, department, ...}.
        """
        token = await self._ensure_token()
        client = await self._get_client()
        url = f"{self.BASE_URL}/user/list"
        params = {"access_token": token, "department_id": str(department_id), "fetch_child": "1"}
        resp = await client.get(url, params=params)
        resp.raise_for_status()
        body = resp.json()
        if body.get("errcode") != 0:
            raise RuntimeError(f"WeCom user list error [{body.get('errcode')}]: {body.get('errmsg', 'unknown')}")
        return body.get("userlist", [])

    async def get_approval_data(
        self, start_time: int, end_time: int
    ) -> list:
        """Fetch approval (审批) data for a date range."""
        body = {
            "starttime": start_time,
            "endtime": end_time,
            "cursor": 0,
            "size": 100,
            "sp_status": 2,
        }
        data = await self._post("oa/getapprovalinfo", body)
        return data.get("sp_no_list", [])

    async def close(self):
        if self._client:
            await self._client.aclose()
            self._client = None
