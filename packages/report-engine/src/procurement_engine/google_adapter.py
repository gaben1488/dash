"""Read-only Google REST adapter. Credentials are supplied externally, never persisted."""
from __future__ import annotations

import json
import os
import time
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

from .atomic_snapshot import SourcePayload, capture_atomic_snapshot
from .raw_pipeline import (
    FORMULA_ERRORS,
    RAW_RULES_VERSION,
    RENDERER_VERSION,
    header_hash,
)


class GoogleReadError(RuntimeError):
    pass


class GoogleReadClient:
    def __init__(self, access_token=None, *, credentials=None):
        self._token = access_token or os.environ.get('GOOGLE_ACCESS_TOKEN')
        self._credentials = credentials
        if not self._token and self._credentials is None:
            self._credentials = self._environment_credentials()

    @staticmethod
    def _environment_credentials():
        import google.auth
        from google.oauth2 import service_account

        scopes = ['https://www.googleapis.com/auth/spreadsheets.readonly',
                  'https://www.googleapis.com/auth/drive.readonly']
        email = os.environ.get('GOOGLE_SERVICE_ACCOUNT_EMAIL')
        key = os.environ.get('GOOGLE_PRIVATE_KEY')
        try:
            if email and key:
                return service_account.Credentials.from_service_account_info({
                    'client_email': email, 'private_key': key.replace('\\n', '\n'),
                    'token_uri': 'https://oauth2.googleapis.com/token'}, scopes=scopes)
            if os.environ.get('GOOGLE_APPLICATION_CREDENTIALS'):
                credentials, _ = google.auth.default(scopes=scopes)
                return credentials
        except (ValueError, google.auth.exceptions.GoogleAuthError):
            raise GoogleReadError('GOOGLE_AUTH_CONFIGURATION_INVALID') from None
        raise GoogleReadError('GOOGLE_CREDENTIALS_REQUIRED')

    def _access_token(self):
        if self._token:
            return self._token
        from google.auth.exceptions import GoogleAuthError
        from google.auth.transport.requests import Request as AuthRequest

        try:
            if not self._credentials.valid:
                self._credentials.refresh(AuthRequest())
        except (ValueError, OSError, GoogleAuthError):
            raise GoogleReadError('GOOGLE_AUTH_REFRESH_FAILED') from None
        if not self._credentials.token:
            raise GoogleReadError('GOOGLE_AUTH_TOKEN_MISSING')
        return self._credentials.token

    def _get(self, url, params=None):
        if params:
            url += '?' + urlencode(params)
        for attempt in range(5):
            request=Request(url,headers={'Authorization':'Bearer '+self._access_token()})
            delay = 2 ** attempt
            try:
                with urlopen(request,timeout=60) as response:
                    return json.load(response)
            except HTTPError as exc:
                if exc.code not in {429, 500, 502, 503, 504} or attempt == 4:
                    raise GoogleReadError(f'GOOGLE_READ_HTTP_{exc.code}') from None
                retry_after = (exc.headers or {}).get('Retry-After', '')
                if retry_after.isdigit():
                    delay = max(delay, min(int(retry_after), 60))
            except (URLError, TimeoutError, ConnectionError):
                if attempt == 4:
                    raise GoogleReadError('GOOGLE_READ_NETWORK_ERROR') from None
            time.sleep(delay)
        raise GoogleReadError('GOOGLE_READ_RETRIES_EXHAUSTED')

    def revision(self, provider_id):
        data=self._get('https://www.googleapis.com/drive/v3/files/'+quote(provider_id,safe=''),
                       {'fields':'id,mimeType,modifiedTime,version','supportsAllDrives':'true'})
        if data.get('mimeType')!='application/vnd.google-apps.spreadsheet':
            raise GoogleReadError('GOOGLE_SOURCE_NOT_SPREADSHEET')
        return str(data.get('version') or data.get('modifiedTime') or '') or None

    def grid(self, provider_id, sheet_id):
        data=self._get('https://sheets.googleapis.com/v4/spreadsheets/'+quote(provider_id,safe=''),
                       {'fields':'sheets.properties'})
        hits=[s['properties'] for s in data.get('sheets',[]) if s['properties']['sheetId']==sheet_id]
        if len(hits)!=1:
            raise GoogleReadError('GOOGLE_SHEET_ID_NOT_FOUND')
        return hits[0]

    def values(self,provider_id,title,start,end,columns):
        return self._values(provider_id,title,start,end,columns,'UNFORMATTED_VALUE')

    def formulas(self,provider_id,title,start,end,columns):
        return self._values(provider_id,title,start,end,columns,'FORMULA')

    def formula_context(self,provider_id):
        data=self._get('https://sheets.googleapis.com/v4/spreadsheets/'+quote(provider_id,safe=''),
                       {'fields':'sheets.properties(sheetId,title),namedRanges(name,range)'})
        return {'sheets':sorted((s['properties'] for s in data.get('sheets',[])),key=lambda x:x['sheetId']),
                'named_ranges':sorted(data.get('namedRanges',[]),key=lambda x:x['name'])}

    def _values(self,provider_id,title,start,end,columns,render_option):
        letters='';n=columns
        while n:
            n,rem=divmod(n-1,26);letters=chr(65+rem)+letters
        a1="'"+title.replace("'","''")+f"'!A{start}:{letters}{end}"
        data=self._get('https://sheets.googleapis.com/v4/spreadsheets/'+quote(provider_id,safe='')+'/values/'+quote(a1,safe=''),
                       {'valueRenderOption':render_option,'dateTimeRenderOption':'SERIAL_NUMBER','majorDimension':'ROWS'})
        return data.get('values',[])


class GoogleSheetSourceAdapter:
    def __init__(self,contract,client,chunk_rows=400):
        self.contract=contract;self.client=client;self.chunk_rows=chunk_rows
        self.source_id=contract['source_id'];self.role=contract['role'];self.provider_id=contract['provider_id']
        if not 1<=chunk_rows<=1000:
            raise ValueError('CHUNK_ROWS_OUT_OF_BOUNDS')
        self.allowed_schema_fingerprints=(contract['schema_fingerprint'],)

    def revision_token(self):
        return self.client.revision(self.provider_id)

    def read_payload(self):
        c=self.contract;grid=self.client.grid(self.provider_id,c['sheet_id'])
        if grid['title']!=c['sheet']:
            raise GoogleReadError('GOOGLE_SHEET_TITLE_CHANGED_REVIEW_CONTRACT')
        count=grid['gridProperties']['rowCount']
        if grid['gridProperties']['columnCount']<c['columns']:
            raise GoogleReadError('GOOGLE_SOURCE_COLUMNS_MISSING')
        values=[[] for _ in range(count)]
        for start in range(1,count+1,self.chunk_rows):
            end=min(start+self.chunk_rows-1,count)
            chunk=self.client.values(self.provider_id,c['sheet'],start,end,c['columns'])
            if len(chunk)>end-start+1:
                raise GoogleReadError('GOOGLE_RANGE_OVERFLOW')
            for offset,row in enumerate(chunk):
                if len(row)>c['columns']:
                    raise GoogleReadError('GOOGLE_COLUMN_OVERFLOW')
                if any(isinstance(v,str) and v in FORMULA_ERRORS for v in row):
                    raise GoogleReadError(f'GOOGLE_FORMULA_ERROR:{self.source_id}:{start+offset}')
                values[start-1+offset]=row
        metadata={'sheet_title':c['sheet'],'row_count':count,
                  'column_count':c['columns'],'units':c['units'],'grbs':c.get('grbs')}
        # Legacy adapters can still produce diagnostic snapshots; missing evidence cannot pass closure.
        if hasattr(self.client,'formula_context') and hasattr(self.client,'formulas'):
            context=self.client.formula_context(self.provider_id)
            full_columns=grid['gridProperties']['columnCount']
            formulas=[]
            for start in range(1,count+1,self.chunk_rows):
                end=min(start+self.chunk_rows-1,count)
                chunk=self.client.formulas(self.provider_id,c['sheet'],start,end,full_columns)
                if len(chunk)>end-start+1 or any(len(row)>full_columns for row in chunk):
                    raise GoogleReadError('GOOGLE_FORMULA_RANGE_OVERFLOW')
                for offset,row in enumerate(chunk):
                    for column,value in enumerate(row,1):
                        if isinstance(value,str) and value.startswith('='):
                            formulas.append({'row':start+offset,'column':column,'formula':value})
            metadata['formula_evidence']={**context,'rows':count,'columns':full_columns,'formulas':formulas}
        return SourcePayload(self.source_id,self.role,self.provider_id,values,str(c['sheet_id']),
            header_hash(values,c['header_rows']),metadata=metadata)


def capture_google(registry,client=None,*,timezone_name='Asia/Kamchatka',max_attempts=3):
    client=client or GoogleReadClient()
    adapters=[GoogleSheetSourceAdapter(c,client) for c in registry['sources']]
    now=datetime.now(timezone.utc)
    local=now.astimezone(ZoneInfo(timezone_name))
    bundle=capture_atomic_snapshot(adapters,report_date=local.strftime('%d.%m.%Y'),report_year=local.year,
        rules_version=RAW_RULES_VERSION,renderer_version=RENDERER_VERSION,max_attempts=max_attempts)
    # A midnight rollover invalidates the requested date; rerun for the new local day.
    captured=datetime.fromisoformat(bundle.manifest['captured_at']).astimezone(ZoneInfo(timezone_name))
    if captured.date()!=local.date():
        raise GoogleReadError('CAPTURE_CROSSED_LOCAL_MIDNIGHT_RETRY')
    contracts={s['source_id']:s for s in registry['sources']}
    sources=[]
    for payload in bundle.payloads:
        c=contracts[payload.source_id]
        sources.append({k:c[k] for k in ('source_id','role','provider_id','sheet','sheet_id','columns','grbs')})
        sources[-1].update(rows=len(payload.semantic_values),values=payload.semantic_values,
            before=bundle.before[payload.source_id],after=bundle.after[payload.source_id])
        if payload.metadata and 'formula_evidence' in payload.metadata:
            sources[-1]['formula_evidence']=payload.metadata['formula_evidence']
    return {'capture_version':'connector-capture-v1','captured_at':bundle.manifest['captured_at'],
        'acquisition_started_at':now.isoformat(), 'acquisition_completed_at':datetime.now(timezone.utc).isoformat(),
        'report_date':local.strftime('%d.%m.%Y'),'report_year':local.year,'timezone':timezone_name,'sources':sources}
