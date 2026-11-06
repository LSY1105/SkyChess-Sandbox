import re, sys

path = sys.argv[1] if len(sys.argv) > 1 else 'q5-2029-report.yaml'
t = open(path, encoding='utf-8').read()
i = t.find('Operating Costs Statement')
seg = re.sub(r'\s+', ' ', t[i:i + 7000])

rows = {}
pat = re.compile(r'row "([A-Za-z& ,\.]{3,48}): \$([\-\d,]+)')
for m in pat.finditer(seg):
    rows[m.group(1)] = float(m.group(2).replace(',', ''))

tr = rows['Total Revenue']
dco = rows['Direct Cash Operating Costs']
ioc = rows['Indirect Operating Costs']
toc = rows['Total Ownership Costs']

print('=' * 76)
print('★ Q1/2029 损益表完全闭合验证')
print('=' * 76)
print(f'  Total Revenue                 ${tr:>15,.0f}')
print(f'  − Direct Cash Operating Costs ${dco:>15,.0f}')
print(f'  − Indirect Operating Costs    ${ioc:>15,.0f}')
print(f'  − Total Ownership Costs       ${toc:>15,.0f}')
net = tr - dco - ioc - toc
print(f'  = 经营利润                     ${net:>15,.0f}')
print(f'  报表税前利润                   ${2262479:>15,.0f}')
print(f'  差额                          ${net - 2262479:>15,.0f}')

print()
print('  间接成本明细:')
ind_keys = ['Passenger Services', 'Ticketing, Sales and Promotion',
            'General & Administration', 'Cargo Overheads']
s = 0
for k in ind_keys:
    v = rows.get(k, 0)
    s += v
    print(f'    {k:36} ${v:>13,.0f}')
print(f'    {"小计":36} ${s:>13,.0f}   (报表 Indirect = ${ioc:,.0f})')

print()
print('  持有成本明细:')
for k in ['Depreciation on Owned Assets', 'Depreciation on Right of Use Assets',
          'Wet Lease Payments', 'Insurance']:
    print(f'    {k:40} ${rows.get(k,0):>13,.0f}')
own = sum(rows.get(k, 0) for k in
          ['Depreciation on Owned Assets', 'Depreciation on Right of Use Assets',
           'Wet Lease Payments', 'Insurance'])
print(f'    {"小计":40} ${own:>13,.0f}   (报表 Total Ownership = ${toc:,.0f})')

print()
print('  现金直接成本明细:')
for k in ['Fuel', 'Sustainable Aviation Fuel', 'Carbon', 'Maintenance', 'Flight Crew',
          'Cabin Crew', 'Landing', 'Navigation', 'Aircraft Handling',
          'Traffic Handling', 'Cargo Handling']:
    print(f'    {k:40} ${rows.get(k,0):>13,.0f}')