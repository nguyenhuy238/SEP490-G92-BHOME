"""Generate a grouped manual Postman catalog from current OpenAPI + MVC descriptors.

Usage: python scripts/postman/Generate-SimpleCollection.py swagger.json descriptors.json
No HTTP requests, database operations or credentials are read by this script.
"""
import argparse
import copy
import csv
import datetime as dt
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / 'docs/testing/postman'
args = argparse.ArgumentParser()
args.add_argument('openapi', type=pathlib.Path)
args.add_argument('descriptors', type=pathlib.Path)
opts = args.parse_args()
api = json.loads(opts.openapi.read_text(encoding='utf-8-sig'))
actions = json.loads(opts.descriptors.read_text(encoding='utf-8-sig'))
schemas = api['components']['schemas']
inventory = list(csv.DictReader((ROOT / 'docs/api/BE_API_INVENTORY_2026-11-08.csv').open(encoding='utf-8-sig')))
report = (ROOT / 'docs/reports/BHOME_BE_BUSINESS_FLOW_API_COVERAGE_2026-11-09.md').read_text(encoding='utf-8')
descriptions = {(m,p):d for m,p,d in re.findall(r'^\| `(GET|POST|PUT|PATCH|DELETE) ([^`]+)` \| ([^|]+) \|', report, re.M)}
groups = dict.fromkeys(r['Group'] for r in inventory)
group_for = {(r['Method'],r['Route']):r['Group'] for r in inventory}
assert {(a['Method'],a['Route']) for a in actions} == set(group_for), 'Refresh report/inventory first.'
variables = {}
def var(key, value='', secret=False, description=''):
    if key not in variables:
        variables[key] = dict(key=key,value=str(value),type='secret' if secret else 'default',enabled=True,description=description)
    return '{{'+key+'}}'

today = dt.datetime.now(dt.timezone(dt.timedelta(hours=7))).date()
defaults = {
    'baseUrl':'https://localhost:7240', 'dateD0':today.isoformat(), 'dateD1':(today+dt.timedelta(days=1)).isoformat(),
    'dateD2':(today+dt.timedelta(days=30)).isoformat(), 'contractEndDate':(today+dt.timedelta(days=365)).isoformat(),
    'period':today.replace(day=1).isoformat(), 'nowUtc':dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace('+00:00','Z'),
    'taskDueAt':dt.datetime.combine(today+dt.timedelta(days=7),dt.time(10),dt.timezone(dt.timedelta(hours=7))).isoformat(),
    'ownerEmail':'owner.dev@example.invalid','staffEmail':'staff.dev@example.invalid','tenantEmail':'tenant.dev@example.invalid',
    'newStaffEmail':'staff.manual.test@example.invalid','testName':'Dữ liệu test Postman BHOME',
    'locationName':'Cơ sở kiểm thử Postman','locationAddress':'Địa chỉ tổng hợp phục vụ kiểm thử',
    'roomNumber':'PM-101','fullName':'Người dùng kiểm thử','phone':'0900000000',
    'testReason':'Kiểm thử thủ công với dữ liệu tổng hợp','taskTitle':'Kiểm tra khu vực chung bằng Postman',
    'monthlyRent':'3000000','requiredDeposit':'3000000','paymentAmount':'3000000','confirmedValue':'100',
    'identityNumber':'000000000001','dateOfBirth':'2000-01-01','identityIssueDate':'2020-01-01',
    'identityExpiryDate':'2040-01-01','page':'1','pageSize':'20','idempotencyKey':'',
    'imageContentType':'image/png', 'signingPage':'1', 'publicPhotoIndex':'0',
    'bankName':'Ngân hàng kiểm thử','bankAccountNumber':'0000000000','bankAccountName':'TAI KHOAN TEST',
    'transactionReference':'PM-MANUAL-001','providerIdentity':'MANUAL','currency':'VND',
}
for k,v in defaults.items():var(k,v)
for role in ['owner','staff','tenant']:
    for suffix in ['Password','AccessToken','RefreshToken']:var(role+suffix,secret=True)
for key in ['newPassword','invitationToken','resetToken','newStaffInitialPassword','clientSecret','pushToken']:
    var(key,secret=True)
var('dateOfIssue',defaults['identityIssueDate'])

def resolve(schema):
    if '$ref' in schema:return {**schemas[schema['$ref'].split('/')[-1]], **{k:v for k,v in schema.items() if k!='$ref'}}
    if 'allOf' in schema:
        result={k:v for k,v in schema.items() if k!='allOf'}
        for child in schema['allOf']:result={**resolve(child),**result}
        return result
    return schema

resource_ids = {
    'locations':'locationId','rooms':'roomId','assets':'assetId','staff':'managedStaffUserId',
    'contracts':'contractId','main-drafts':'mainDraftId','holdings':'holdingContractId',
    'operational-tasks':'taskId','operational-task-templates':'taskTemplateId',
    'incidents':'incidentId','work-orders':'workOrderId','invoices':'invoiceId',
    'invoice-adjustments':'adjustmentId','payment-transactions':'paymentId','refund-requests':'refundId',
    'notifications':'notificationId','announcements':'announcementId','devices':'deviceId',
    'residents':'residentId','meter-tasks':'meterTaskId','meters':'meterId','readings':'readingId',
    'asset-templates':'assetTemplateId','asset-template-sync-runs':'assetSyncRunId',
    'billing-policies':'policyId','operating-policies':'operatingPolicyId','expenses':'expenseId',
    'financial-scenarios':'scenarioId','certificates':'certificateId','utility-tariffs':'tariffId',
    'utility-source-bills':'sourceBillId','utility-reconciliations':'reconciliationId',
    'utility-profiles':'utilityProfileId','utility-source-meters':'sourceMeterId','setup-evidence':'setupEvidenceId',
}
def path_key(route, name):
    name=name.split(':')[0]
    if name=='page':return 'signingPage'
    if name=='index':return 'publicPhotoIndex'
    if name=='profile':return 'ocrProfile'
    if name=='side':return 'identitySide'
    if name=='taskId' and '/ocr/meter-tasks/' in route:return 'meterTaskId'
    if name=='fileId':return 'draftFileId' if '/main-drafts/' in route else 'handoverEvidenceId' if '/handover/' in route else 'previewFileId' if '/previews/' in route else 'expenseEvidenceId'
    if name in ['evidenceId','imageId']:return 'incidentEvidenceId' if '/incidents/' in route else 'taskEvidenceId' if '/operational-tasks/' in route else 'adjustmentEvidenceId' if '/invoice-adjustments/' in route else 'moveOutEvidenceId'
    if name=='entryId':return 'emergencyActionId'
    if name!='id':return name
    if '/holding-' in route:return 'holdingContractId'
    before=route.split('{id',1)[0].rstrip('/').split('/')[-1]
    return resource_ids.get(before,before.replace('-','')+'Id')

def context_key(r):
    route=r['Route']
    if '/handover' in route:return 'handover'
    if '/move-out' in route:return 'moveOut'
    if '/main-drafts' in route:return 'mainDraft'
    if '/contracts/' in route or route.endswith('/contracts'):return 'contract'
    for part in reversed(route.split('/')):
        if part in resource_ids:return resource_ids[part].removesuffix('Id')
    return r['Controller'][0].lower()+r['Controller'][1:]

def version_key(r):
    c=context_key(r)
    if r['Controller']=='AccountProfile':return 'profileVersion'
    if r['Controller']=='StaffAdministration':return 'staffAccountVersion'
    if r['Controller']=='StaffLocationAssignments':return 'locationVersion'
    if r['Controller']=='BillingSchedules':return 'billingScheduleVersion'
    if r['Controller']=='ReceivingAccounts':return 'receivingAccountVersion'
    if r['Controller']=='MainDrafts' and r['Action']=='Settings':return 'mainSettingsVersion'
    return c+'Version'

def value(schema, name, r, depth=0):
    schema=resolve(schema); n=name.lower(); typ=schema.get('type'); fmt=schema.get('format')
    if depth>8:return None
    if 'enum' in schema:return schema['enum'][0]
    if typ=='object' or 'properties' in schema:
        required=schema.get('required',[])
        data={k:value(s,k,r,depth+1) for k,s in schema.get('properties',{}).items() if not s.get('readOnly') and not (resolve(s).get('nullable') and k not in required and (resolve(s).get('format')=='uuid' or resolve(s).get('format') in ['date','date-time']))}
        ref=schema.get('properties',{})
        if 'through' in ref and 'rate' in ref:data['through']=None
        if 'type' in ref and 'locationIds' in ref and data.get('type')=='LOCATION':
            data['roomIds']=[];data['userIds']=[]
        if r['Controller']=='BillingPolicies' and 'chargeCode' in data:
            data.update(chargeCode='RENT',rate=var('monthlyRent'))
        return data
    if typ=='array':
        if n in ['evidenceids','locationids','roomids','userids','residentids']:
            return [var({'evidenceids':'evidenceId','locationids':'locationId','roomids':'roomId','userids':'tenantUserId','residentids':'residentId'}[n])]
        if n=='channels':return ['IN_APP']
        if n in ['assets','items','tiers','segments']:return [value(schema.get('items',{}),name+'Item',r,depth+1)]
        return []
    if fmt=='uuid':
        key={'representativeresidentid':'residentId','representativecontractid':'contractId','ownersignerid':'ownerUserId','staffuserid':'staffUserId','staffid':'staffUserId','assignedstaffid':'staffUserId','inspectionstaffid':'staffUserId','beneficiaryresidentid':'residentId','reviewedfileid':'reviewedFileId','parentmeterid':'sourceMeterId','templateid':'assetTemplateId','itemid':'assetTemplateItemId'}.get(n,name[0].lower()+name[1:])
        if name=='id' and r['Controller']=='AssetInventory':return var('assetTemplateItemId','7f2e5520-0b72-447f-8f10-e98dfda24001',description='UUID tổng hợp cho item mới trong template, không phải ID của bản ghi DB có sẵn.')
        return var(key,description='Lấy ID thật từ response hoặc điền ID của dữ liệu test đã có; không dùng GUID giả.')
    if 'version' in n:
        key='locationVersion' if n=='locationversion' else 'billingScheduleVersion' if n=='expectedbillingscheduleversion' else 'staffAccountVersion' if n=='accountversion' else version_key(r)
        create=r['Method']=='POST' and r['Action'] in ['Create','CreateHolding','Register','CreateTariff','Profile','Save'] and '{' not in r['Route']
        if create and typ!='string':return 0
        return var(key,'0' if typ in ['integer','number'] else '',description='GET bản ghi để lấy version mới trước cập nhật; không tự tăng version.')
    if typ=='boolean':
        if n=='enabled' and r['Controller']=='ReceivingAccounts':return True
        if n in ['isactive','humanconfirmed','humanverified','humanreviewed','verified','approve','acceptvariance']:return True
        return False
    if typ in ['integer','number']:
        if n=='capacity':return 2
        if n in ['monthlyrent','requireddeposit']:return var(name,defaults[name])
        if n=='amount':return var('paymentAmount')
        if n=='confirmedvalue':return var('confirmedValue')
        if n in ['page','pagesize']:return var('page' if n=='page' else 'pageSize')
        if n in ['draftday','finalday','dueday','meterday','meterdueday']:return {'draftday':10,'finalday':15,'dueday':20,'meterday':5,'meterdueday':8}[n]
        if n=='through' and schema.get('nullable'):return None
        if 'offset' in n or n in ['decimalplaces','tolerance','freequantity']:return 0
        if n in ['rate','unitprice','holdingdeposit','securitydeposit']:return 3000000 if 'deposit' in n else 3500
        if n in ['quantity','forecastmonths','estimatedminutes','estimatedcost','actualcost','pricerate']:return {'forecastmonths':12,'estimatedminutes':60,'estimatedcost':100000,'actualcost':100000}.get(n,1)
        return schema.get('default',max(1,schema.get('minimum',1)))
    if fmt=='date':
        key='dateOfBirth' if n=='dateofbirth' else 'identityIssueDate' if n=='dateofissue' else 'identityExpiryDate' if n=='dateofexpiry' else 'contractEndDate' if n=='enddate' else 'dateD2' if n=='effectiveto' else 'period' if n in ['period','billingperiod','effectivefrom'] else 'dateD0'
        if n=='effectivefrom' and r['Controller'] in ['StaffLocationAssignments','Capture']:key='dateD0'
        return var(key)
    if fmt=='date-time':return var('taskDueAt' if n in ['dueat','expiresat','scheduledat','targetcompletionat'] else 'nowUtc')
    if typ=='string' or fmt:
        if any(x in n for x in ['password','secret','pushtoken']):return var('newStaffInitialPassword' if n=='initialpassword' else 'ownerPassword' if n in ['password','currentpassword'] else name,secret=True)
        if n in ['token','invitationtoken']:return var('invitationToken' if 'invitation' in r['Route'] else 'resetToken',secret=True)
        values={
            'email':var('newStaffEmail') if r['Controller']=='StaffAdministration' else var('ownerEmail'),
            'phone':var('phone'),'tenantphone':var('phone'),'fullname':var('fullName'),
            'citizenidentitynumber':var('identityNumber'),'citizennumber':var('identityNumber'),'name':var('locationName' if r['Controller']=='Locations' else 'testName'),
            'address':var('locationAddress'),'roomnumber':var('roomNumber'),'floor':'1',
            'description':'Báo cáo kiểm thử tổng hợp: đèn khu vực chung không hoạt động.',
            'displaylabel':'Người ở kiểm thử','title':var('taskTitle'),'requirements':'Kiểm tra và ghi nhận kết quả bằng dữ liệu test.',
            'reason':var('testReason'),'note':var('testReason'),'notes':var('testReason'),
            'terms':'Điều khoản mẫu dùng riêng cho kiểm thử, không dùng như hợp đồng đã duyệt.',
            'timezone':'Asia/Ho_Chi_Minh','currency':'VND','gender':'Nam','nationality':'Việt Nam',
            'placeoforigin':'Địa chỉ tổng hợp','residentialaddress':'Địa chỉ cư trú tổng hợp',
            'placeofissue':'Cơ quan cấp giả lập','tenantplaceofissue':'Cơ quan cấp giả lập',
            'condition':'Good','roomcondition':'Phòng kiểm thử sạch, không hư hỏng','commonarea':'Khu vực chung kiểm thử','trackingmode':'BulkQuantity','scope':'Source',
            'keysandaccess':'02 chìa khóa kiểm thử','provideridentity':'MANUAL',
            'bankreference':var('transactionReference'),'externalreference':var('transactionReference'),
            'statementreference':'Sao kê giả lập kiểm thử','verificationreason':var('testReason'),
            'transferdescription':'Chuyển khoản mô phỏng kiểm thử','chargecode':'ELECTRICITY','body':'Thông báo nội bộ với dữ liệu tổng hợp.',
            'employmenttype':'FullTime','salarytype':'Monthly','contractnumber':'PM-STAFF-001',
            'status':'Pending' if r['Controller']=='ResidenceTasks' else 'Active',
            'platform':'Android','priority':'P2','type':'LOCATION' if r['Controller']=='NotificationWorkspace' else 'Test',
            'category':'Maintenance','expensetype':'OPERATING','sourcereference':'Tài liệu biểu giá thử nghiệm',
            'accountnumber':var('bankAccountNumber'),'accountname':var('bankAccountName'),'accountholder':var('bankAccountName'),'bankidentifier':'TEST','bankname':var('bankName'),
        }
        v=values.get(n,schema.get('default','Dữ liệu kiểm thử tổng hợp'))
        if isinstance(v,str) and not v.startswith('{{'):
            v=v[:schema.get('maxLength',10000)]
            v=v.ljust(schema.get('minLength',0),'x')
        return v
    return None

# Role permissions come from repository constants, not a client-side authorization claim.
permissions={}
permission_source=(ROOT/'src/backend/BHome.Domain/IdentityAccess/Permissions.cs').read_text()
for match in re.finditer(r'public static class (\w+)\s*\{([^{}]*)\}',permission_source):
    for key,val in re.findall(r'const string (\w+) = "([^"]+)"',match[2]):permissions[match[1]+'.'+key]=val
policy_roles={}
role_source=(ROOT/'src/backend/BHome.Domain/IdentityAccess/RolePermissions.cs').read_text()
for symbol,roles in re.findall(r'\[Permissions\.([\w.]+)\] = Allow\(([^)]+)\)',role_source):
    policy_roles[permissions[symbol]]=set(re.findall(r'Roles\.(\w+)',roles))
def role_for(r):
    if r['Anonymous']:return None
    allowed={'Owner','Staff','Tenant'}
    for a in r['Authorization']:
        if a.get('Roles'):allowed &= set(a['Roles'].split(','))
        if a.get('Policy'):allowed &= policy_roles[a['Policy']]
    c,a=r['Controller'],r['Action']
    if c=='ResidenceTasks' and a in ['Update','Upload']:return 'tenant'
    if c=='NotificationWorkspace' and a in ['Rooms','Room']:return 'tenant'
    if c=='InvoiceAdjustments' and a in ['Submit','Upload']:return 'tenant'
    if c=='Capture' and a=='Staff':return 'owner'
    return next(x.lower() for x in ['Owner','Staff','Tenant'] if x in allowed)

def event(listen, code):return dict(listen=listen,script=dict(type='text/javascript',exec=code.splitlines()))
def json_body(data):
    raw=json.dumps(data,ensure_ascii=False,indent=2)
    # Numeric DTO fields must remain JSON numbers after variable substitution.
    return dict(mode='raw',raw=raw,options=dict(raw=dict(language='json')))

def render_body(schema,data):
    if data is None:return 'null'
    schema=resolve(schema)
    if isinstance(data,dict):return '{\n'+',\n'.join('  '+json.dumps(k)+': '+render_body(schema.get('properties',{}).get(k,{}),v).replace('\n','\n  ') for k,v in data.items())+'\n}'
    if isinstance(data,list):return '['+', '.join(render_body(schema.get('items',{}),v) for v in data)+']'
    if isinstance(data,str) and data.startswith('{{') and schema.get('type') in ['number','integer','boolean']:return data
    return json.dumps(data,ensure_ascii=False)

def id_capture(r):
    route=r['Route']; c=r['Controller']; a=r['Action']
    if r['Method']=='DELETE' or any(x in a.lower() for x in ['history','preparation','configuration','choices','previewinfo']):return []
    op=api['paths'].get(re.sub(r':[^}]+','',route),{}).get(r['Method'].lower(),{})
    response_schemas=[resolve(response.get('content',{}).get('application/json',{}).get('schema',{})) for code,response in op.get('responses',{}).items() if code.startswith('2')]
    properties=set().union(*(s.get('properties',{}) for s in response_schemas))
    known_untyped=c=='Contracts' and a in ['Create','CreateHolding','Renewal','ConvertHolding','UploadHandover','UploadEvidence']
    if not properties and not known_untyped:return []
    ctx=context_key(r); mapping=[]
    # Only capture objects, never silently select the first item of a list.
    key=ctx+'Id'
    if c=='Contracts' and a=='CreateHolding':key='holdingContractId'
    if c=='Capture':key={'Location':'locationId','Room':'roomId','Resident':'residentId','Meter':'meterId','Task':'meterTaskId','Evidence':'meterEvidenceId','ConfirmMeter':'readingId','Identity':'residentId','Staff':'managedStaffUserId','Assignment':'assignmentId'}.get(a,key)
    if c=='StaffAdministration':key='managedStaffUserId'
    if c=='AssetInventory' and a=='Verify':key='assetId'
    if c=='MainDrafts' and a in ['Generate','SigningReview']:key='reviewedFileId' if a=='SigningReview' else 'draftFileId'
    if c=='MainDrafts' and a=='Release':key='contractId'
    if c=='AssetInventory' and a in ['Publish','Sync']:key='assetSyncRunId'
    if c=='Contracts' and a=='GeneratePreview':key='previewFileId'
    if '/handover/evidence' in route:key='handoverEvidenceId'
    if '/move-out/evidence' in route:key='moveOutEvidenceId'
    if c=='Refunds':key='refundId'
    if '/adjustment-requests' in route:key='adjustmentId'
    if c=='InvoiceAdjustments' and a=='Upload':key='adjustmentEvidenceId'
    if c=='OperationalTasks' and a=='Upload':key='taskEvidenceId'
    if c=='IncidentReports' and a=='Upload':key='incidentEvidenceId'
    if c=='IncidentReports' and a=='EmergencyAction':key='emergencyActionId'
    if c=='AssetInventory' and a in ['Metadata','GetMetadata']:key='assetMetadataId'
    source='data.userId' if c=='StaffAdministration' else 'data.id'
    if c=='Contracts' and ('/move-out' in route or '/handover' in route):source='null' if a not in ['UploadEvidence','UploadHandover'] else 'data.id'
    if c=='AssetInventory' and a=='Verify':source='data.assetId'
    if c=='IncidentReports':
        source='data.incidentId' if a=='Submit' else 'data.workOrderId' if a=='Assign' else 'data.resourceId' if a in ['Upload','EmergencyAction'] else 'data.id'
        if a=='Assign':key='workOrderId';var(key)
    if c=='WorkOrders':source='data.workOrderId || data.id'
    if c=='MainDrafts' and a=='Generate':source='data.pdf && data.pdf.id'
    if c=='AssetInventory' and a in ['Publish','Sync']:source='data.runId'
    if c=='PaymentTransactions' and a in ['Register','Allocate','AllocateDeposit']:source='data.transferId || data.id'
    if c in ['AssetInventory','UtilityWorkspace','OperatingPolicies'] and a in ['Publish','Create','Update']:
        source='data.id'
    if properties.intersection(['id','userId','incidentId','workOrderId','assetId','runId']) or known_untyped or c=='MainDrafts' and a=='Generate':
        var(key,description='Tự cập nhật từ response thành công phù hợp; hoặc điền từ GET dữ liệu test.')
        mapping.append(f'const savedId = {source}; if (typeof savedId === "string") pm.environment.set({json.dumps(key)}, savedId);')
    else:
        mapping.append('const savedId = null;')
    if c=='Contracts' and a=='CreateHolding':mapping.append('if (savedId) pm.environment.set("contractId", savedId); // Chọn Holding cho các bước ký chung; giữ holdingContractId riêng.')
    if c=='MainDrafts' and a=='SigningReview':mapping.append('if (savedId) pm.environment.set("draftFileId", savedId);')
    vk=version_key(r)
    if properties.intersection(['accountVersion','version','draftVersion']):
        var(vk,description='Lấy version từ GET trước khi cập nhật; không tự tăng version.')
        mapping.append(f'const savedVersion = data.accountVersion ?? data.version ?? data.draftVersion; if (savedVersion !== undefined && savedVersion !== null) pm.environment.set({json.dumps(vk)}, savedVersion);')
    if c=='AccountProfile':mapping.append('if (data.version) pm.environment.set("profileVersion", data.version);')
    if c=='StaffLocationAssignments' and r['Method']!='GET':mapping.append('pm.environment.unset("locationVersion"); // GET Location lại trước khi sửa.')
    return mapping

folders={k:dict(name=f'{i:02}. {k}',description='Gửi từng request theo luồng; không Run cả folder một cách máy móc. ID/version lấy từ response, các nhánh hủy/rework/publish cần chọn có chủ đích.',item=[]) for i,k in enumerate(groups,1)}
canonical=[]
source_inventory=[dict(host='BHome.Api',method=r['Method'],route=r['Route'],file=r['Source'],line=int(r['Line'])) for r in inventory]
def make(r, login_role=None):
    route=r['Route']; method=r['Method']; c=r['Controller']; a=r['Action']
    path=re.sub(r':[^}]+','',route)
    operation=api['paths'].get(path,{}).get(method.lower())
    if operation is None:
        assert c=='MobileDevelopment', f'Missing OpenAPI operation: {method} {path}'
        operation={'parameters':[], 'responses':{'200':{'description':'Development CA'}}}
    chosen=role_for(r)
    if login_role:chosen=None
    request=dict(method=method,header=[],auth=dict(type='noauth') if chosen is None else dict(type='bearer',bearer=[dict(key='token',value=var(chosen+'AccessToken',secret=True),type='string')]))
    mapped=re.sub(r'\{([^}]+)\}',lambda m:var(path_key(route,m[1])),route)
    params=[]
    for p in operation.get('parameters',[]):
        if p['in']!='query':continue
        schema=resolve(p['schema']); name=p['name']; enabled=p.get('required',False) or name.lower() in ['page','pagesize','locationid','roomid','period','effectiveon','representativeresidentid','residentids','contractid','version']
        query_value=value(schema,name,r)
        if query_value is None:query_value=''
        if isinstance(query_value,list):query_value=query_value[0] if query_value else ''
        if isinstance(query_value,bool):query_value=str(query_value).lower()
        params.append(dict(key=name,value=str(query_value),disabled=not enabled,description='Bật nếu cần lọc; tham số bắt buộc giữ bật.' if not enabled else 'Dữ liệu của luồng hiện tại.'))
    query='&'.join(p['key']+'='+p['value'] for p in params if not p['disabled'])
    request['url']=dict(raw=var('baseUrl')+mapped+('?' +query if query else ''),host=[var('baseUrl')],path=mapped.lstrip('/').split('/'))
    if params:request['url']['query']=params
    body_schema=None
    content=operation.get('requestBody',{}).get('content',{})
    description=descriptions.get((method,route),'API theo source hiện hành.')
    if 'application/json' in content:
        body_schema=content['application/json']['schema']; data=value(body_schema,'body',r)
        if c=='Auth' and a=='Login':data=dict(email=var((login_role or 'owner')+'Email'),password=var((login_role or 'owner')+'Password',secret=True),device='Postman Desktop')
        if c=='Auth' and a=='Refresh':data=dict(refreshToken=var('ownerRefreshToken',secret=True))
        request['body']=dict(mode='raw',raw=render_body(body_schema,data),options=dict(raw=dict(language='json')))
        request['header'].append(dict(key='Content-Type',value='application/json'))
    elif 'multipart/form-data' in content:
        body_schema=content['multipart/form-data']['schema']; props=resolve(body_schema).get('properties',{}); form=[]
        for name,ss in props.items():
            s=resolve(ss); binary=s.get('format')=='binary' or resolve(s.get('items',{})).get('format')=='binary'
            if binary:form.append(dict(key=name,type='file',src=[],description='Chọn file test tổng hợp trên máy trước khi Send.'))
            else:
                data=value(s,name,r)
                if data is not None:form.append(dict(key=name,value=str(data).lower() if isinstance(data,bool) else str(data),type='text'))
        request['body']=dict(mode='formdata',formdata=form)
        description+=' Chọn file tại Body/form-data; Postman tự đặt multipart boundary.'
    else:
        # ASP.NET actions reading Request.Body do not have a requestBody schema in Swagger.
        src=next((x for x in source_inventory if x['host']=='BHome.Api' and (x['method'],x['route'])==(method,route)),None)
        if src and method in ['POST','PUT','PATCH']:
            code='\n'.join((ROOT/src['file']).read_text(encoding='utf-8-sig').splitlines()[src['line']-1:])
            block=re.split(r'\[Http(?:Get|Post|Put|Patch|Delete)',code,maxsplit=1)[0] if not code.startswith('    [Http') else re.split(r'\[Http(?:Get|Post|Put|Patch|Delete)',code, maxsplit=2)[1]
            consumes=re.search(r'Consumes\("(image/[^"\s]+)',block)
            if consumes:
                request['body']=dict(mode='file',file=dict(src=''))
                request['header'].append(dict(key='Content-Type',value=consumes[1]))
                description+=' Body/binary: chọn ảnh tổng hợp đúng Content-Type; không dùng CCCD thật.'
    if method in ['POST','PUT','PATCH','DELETE']:
        request['header'].append(dict(key='Idempotency-Key',value='{{requestIdempotencyKey}}'))
    if method in ['DELETE'] or re.search(r'cancel|complete|finalize|publish|decision|execution|activate|process-events|run-now',route):description+=' Đây là thao tác thay đổi trạng thái/cấu hình: đọc điều kiện và chọn gửi chủ động; không chạy hàng loạt.'
    request['description']=description+'\n\nRole mặc định: '+(chosen or 'Anonymous')+'. Có thể đổi Bearer token để test quyền. ID còn trống phải tạo/lấy từ dữ liệu test; sample không phải dữ liệu đã tồn tại. GET lại để cập nhật version sau mutation. Provider/file upload cần cấu hình hoặc chọn file riêng.'
    scripts=['pm.test("Không có lỗi server", () => pm.expect(pm.response.code).to.be.below(500));','pm.test("Kịch bản hợp lệ trả 2xx", () => pm.expect(pm.response.code).to.be.within(200, 299));','if (pm.response.code >= 200 && pm.response.code < 300) {','  let data; try { data = pm.response.json(); } catch (_) {}','  if (data && typeof data === "object" && !Array.isArray(data)) {']
    if c=='Auth' and a in ['Login','Refresh']:
        role=login_role or 'owner'
        for k in ['AccessToken','RefreshToken']:
            var(role+k,secret=True)
            scripts.append(f'    if (data.{k[0].lower()+k[1:]}) pm.environment.set("{role+k}", data.{k[0].lower()+k[1:]});')
        for key in ['UserId','SessionId']:
            var(role+key);scripts.append(f'    if (data.{key[0].lower()+key[1:]}) pm.environment.set("{role+key}", data.{key[0].lower()+key[1:]});')
    else:scripts += ['    '+line for line in id_capture(r)]
    scripts+=['  }','}']
    name=(login_role.upper()+' — ' if login_role else '')+method+' '+re.sub(r':[^}]+','',route)+' — '+description.split('.')[0][:100]
    item=dict(name=name,request=request,event=[event('test','\n'.join(scripts))],protocolProfileBehavior=dict(disableCookies=True))
    if a=='Login' and c=='Auth':item['name']=(login_role or 'owner').upper()+' — Đăng nhập và lưu token'
    return item

for r in actions:
    item=make(r,'owner' if (r['Controller'],r['Action'])==('Auth','Login') else None)
    folders[group_for[r['Method'],r['Route']]]['item'].append(item)
    canonical.append((r['Method'],r['Route']))
    if (r['Controller'],r['Action'])==('Auth','Login'):
        folders[group_for[r['Method'],r['Route']]]['item'] += [make(r,'staff'),make(r,'tenant')]
for folder in folders.values():
    folder['item'].sort(key=lambda x:(0 if 'Đăng nhập và lưu token' in x['name'] else 1,x['name']))
var('ocrProfile','electricity-mechanical');var('identitySide','front')
pre='''// Blank dates are filled once. Existing manual values are never overwritten.
const today = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
const dates = { dateD0: today, period: today.slice(0,7) + '-01' };
for (const [key, value] of Object.entries(dates)) if (!pm.environment.get(key)) pm.environment.set(key, value);
pm.variables.set('requestIdempotencyKey', pm.environment.get('idempotencyKey') || pm.variables.replaceIn('{{$guid}}'));
// Keep idempotencyKey fixed only when deliberately checking replay of the same operation.
const req = pm.request;
const parts = [req.url.toString(), req.body && req.body.mode === 'raw' ? req.body.raw : '', ...((req.headers && req.headers.all()) || []).map(h => h.value)];
if (req.auth && req.auth.type === 'bearer') parts.push(JSON.stringify(req.auth.toJSON()));
if (req.body && req.body.mode === 'formdata') parts.push(...req.body.formdata.all().filter(x => !x.disabled && x.type !== 'file').map(x => x.value || ''));
const missing = [...new Set(parts.join(' ').match(/{{[^}]+}}/g) || [])].filter(x => { const k=x.slice(2,-2); return !k.startsWith('$') && (pm.variables.get(k) === undefined || pm.variables.get(k) === ''); });
if (missing.length) throw new Error('Điền biến hoặc chạy request tạo/GET trước: ' + missing.join(', '));
'''
health=dict(name='00. Health và hướng dẫn',description='Bắt đầu: kiểm health → đăng nhập ba role → tạo dữ liệu theo luồng. Chỉ gửi từng request, không Run all: nhiều nhánh loại trừ nhau.',item=[])
for path in ['/health/live','/health/ready']:
    health['item'].append(dict(name='GET '+path,request=dict(method='GET',header=[],auth=dict(type='noauth'),url='{{baseUrl}}'+path),event=[event('test','pm.test("HTTP 200", () => pm.response.to.have.status(200));')]))
collection=dict(info=dict(name='BHOME Simple — Toàn bộ API theo luồng',_postman_id='210b9ae9-c81d-4cf3-8829-3d98fb4f191a',schema='https://schema.getpostman.com/json/collection/v2.1.0/collection.json',description='372 API chính, 2 login bổ sung Staff/Tenant, 2 health. Gửi tay từng request. Mẫu sinh từ OpenAPI/DTO và danh mục báo cáo; không phải chứng nhận happy path đã chạy. Không dùng Run collection cho các nhánh hủy/chốt/hoàn tiền. Mật khẩu/token để trống; tài khoản example.invalid không tự được tạo.'),item=[health,*folders.values()],event=[event('prerequest',pre)])
environment=dict(id='78b168eb-3e26-462f-a8ae-02d638493b66',name='BHOME Local',values=list(variables.values()),_postman_variable_scope='environment')
OUT.mkdir(parents=True,exist_ok=True)
(OUT/'BHome.Simple.postman_collection.json').write_text(json.dumps(collection,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
(OUT/'BHome.Local.postman_environment.json').write_text(json.dumps(environment,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(f'Generated {len(canonical)} routes + 2 login variants + 2 health; {len(folders)} business folders; {len(variables)} variables.')
