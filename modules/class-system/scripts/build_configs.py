import json
import os

MODULE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_DIR = os.path.join(MODULE_DIR, 'config')

with open(os.path.join(CONFIG_DIR, '_extracted_classes.json'), encoding='utf-8') as f:
    raw = json.load(f)

all_perks_raw = raw['all_perks']

pt_translations = {
    # Destruction
    'Destruction Mastery': ('Maestria em Destruição', 'Lança feitiços de Destruição com 0,5% a menos de custo de Mágicka por nível de Destruição.'),
    'Destruction Dual Casting': ('Conjuração Dupla de Destruição', 'Lançar um feitiço de Destruição com ambas as mãos sobrecarrega seus efeitos, aumentando o poder em 120% e o custo em 180%.'),
    'Augmented Flames (1)': ('Chamas Aumentadas I', 'Feitiços e efeitos de fogo causam 20% a mais de dano.'),
    'Augmented Flames (2)': ('Chamas Aumentadas II', 'Feitiços e efeitos de fogo causam 40% a mais de dano.'),
    'Augmented Frost (1)': ('Gelo Aumentado I', 'Feitiços e efeitos de gelo causam 20% a mais de dano à Vida e ao Vigor.'),
    'Augmented Frost (2)': ('Gelo Aumentado II', 'Feitiços e efeitos de gelo causam 40% a mais de dano à Vida e ao Vigor.'),
    'Augmented Shock (1)': ('Raios Aumentados I', 'Feitiços e efeitos elétricos causam 20% a mais de dano à Vida e à Mágicka.'),
    'Augmented Shock (2)': ('Raios Aumentados II', 'Feitiços e efeitos elétricos causam 40% a mais de dano à Vida e à Mágicka.'),
    'Impact': ('Impacto', 'Feitiços de projétil de Destruição lançados com ambas as mãos têm 30% de chance de desestabilizar (stagger) o alvo.'),
    'Rune Master': ('Mestre das Runas', 'Permite posicionar runas até três vezes mais longe e aumenta a potência das runas em 10%. O rank 1 foi assumido; confirmar com o dono do projeto.'),
    'Chilling Frost': ('Geada Enregelante', 'Feitiços de gelo reduzem a velocidade de ataque dos inimigos em 20% e infligem 15% de fraqueza a gelo por 10 segundos.'),
    "Winter's Grasp": ('Abraço do Inverno', 'Feitiços de gelo congelam inimigos com menos de 20% de vida em um bloco sólido de gelo por 5 segundos.'),
    'Deafening Shock:': ('Choque Ensurdecedor', 'Feitiços de eletricidade paralisam inimigos com menos de 20% de vida por 5 segundos.'),
    'Crackling Sphere': ('Esfera Crepitante', 'Feitiços elétricos criam um campo estático que desintegra inimigos com menos de 15% de vida restante em cinzas.'),
    'Devouring Flames': ('Chamas Vorazes', 'Feitiços de fogo incendeiam os alvos, fazendo com que fujam em pânico se sua vida estiver abaixo de 20% por 5 segundos.'),
    'Scorched Earth': ('Terra Arrasada', 'Ao derrotar um alvo com fogo, cria uma poça de fogo residual sob o corpo que queima inimigos próximos por 15 segundos.'),
    'Hellstorm': ('Tempestade do Inferno', 'Causa 50% mais dano elemental a alvos que estejam queimando, congelados, silenciados ou sob efeitos debilitantes de Destruição.'),
    'Enduring Flame': ('Chama Duradoura', 'Efeitos de queimadura de feitiços de fogo duram duas vezes mais tempo e causam dano adicional progressivo.'),

    # Alteration
    'Alteration Mastery': ('Maestria em Alteração', 'Lança feitiços de Alteração com 0,5% a menos de custo de Mágicka por nível de Alteração.'),
    'Alteration Dual Casting': ('Conjuração Dupla de Alteração', 'Sobrecarrega feitiços de Alteração lançados com ambas as mãos, aumentando sua magnitude e duração drasticamente.'),
    'Mage Armor (1)': ('Armadura Mágica I', 'Feitiços de proteção como Carne de Carvalho (Oakflesh) e similares são 100% mais fortes se você não estiver usando armadura de metal/couro.'),
    'Mage Armor (2)': ('Armadura Mágica II', 'Feitiços de proteção dérmica são 150% mais fortes se você não estiver usando nenhuma peça de armadura.'),
    'Mage Armor (3)': ('Armadura Mágica III', 'Feitiços de proteção dérmica são 200% mais fortes se você estiver vestindo apenas roupagem mística.'),
    'Magic Resistance (1)': ('Resistência Mágica I', 'Bloqueia passivamente 10% do dano de todos os feitiços e efeitos mágicos inimigos.'),
    'Magic Resistance (2)': ('Resistência Mágica II', 'Bloqueia passivamente 20% do dano de todos os feitiços e efeitos mágicos inimigos.'),
    'Magic Resistance (3)': ('Resistência Mágica III', 'Bloqueia passivamente 30% do dano de todos os feitiços e efeitos mágicos inimigos.'),
    'Stability': ('Estabilidade', 'Feitiços e efeitos mágicos da escola de Alteração duram 25% a mais de tempo.'),
    "Ocato's Preparation": ('Preparação de Ocato', 'Ao entrar em combate, conjura automaticamente o feitiço de armadura mágica dérmica mais poderoso que você conhecer sem gastar Mágicka.'),
    'Atronach': ('O Atronach', 'Absorve 30% da Mágicka de qualquer feitiço inimigo que atingir seu personagem.'),

    # Restoration
    'Restoration Mastery': ('Maestria em Restauração', 'Lança feitiços de Restauração com 0,5% a menos de custo de Mágicka por nível de Restauração.'),
    'Restoration Dual Casting': ('Conjuração Dupla de Restauração', 'Lançar feitiços de Restauração com as duas mãos multiplica exponencialmente a cura e a absorção de dano.'),
    'Vigilant Ward (1)': ('Barreira Vigilante I', 'Barreiras protetoras (Wards) custam 50% menos Mágicka para manter e reduzem o dano físico e mágico recebido em 30%.'),
    'Vigilant Ward (2)': ('Barreira Vigilante II', 'Barreiras protetoras (Wards) custam 80% menos Mágicka para manter e reduzem o dano físico e mágico recebido em 60%.'),
    'Ward Absorb': ('Absorção de Barreira', 'Quando sua barreira protetora bloqueia um feitiço inimigo com sucesso, você recupera Mágicka igual a 30% do custo do feitiço bloqueado.'),
    'Respite': ('Respiro', 'Feitiços de cura restauram também Vigor (Stamina) na mesma proporção em que regeneram a Vida.'),
    'Rebuke Undead': ('Repelir Mortos-Vivos', 'Feitiços e efeitos contra mortos-vivos têm magnitude ampliada e fazem esqueletos e draugrs recuarem desestabilizados.'),
    'Mercy': ('Misericórdia', 'Feitiços de cura lançados em aliados concedem um escudo bônus de regeneração contínua por 10 segundos.'),
    'Inner Light (1)': ('Luz Interior I', 'Aumenta a magnitude de todos os seus feitiços benéficos e de cura em 15%.'),
    'Inner Light (2)': ('Luz Interior II', 'Aumenta a magnitude de todos os seus feitiços benéficos e de cura em 30%.'),
    'Inspire': ('Inspirar', 'Aumenta a taxa de regeneração de Mágicka e Vigor de todos os aliados no grupo próximos em 25%.'),
    'Inspire (1)': ('Inspirar I', 'Aumenta a taxa de regeneração de Mágicka e Vigor de todos os aliados próximos em 20%.'),
    'Inspire (2)': ('Inspirar II', 'Aumenta a taxa de regeneração de Mágicka e Vigor de todos os aliados próximos em 40%.'),

    # Conjuration
    'Conjuration Mastery': ('Maestria em Conjuração', 'Lança feitiços de Conjuração com 0,5% a menos de custo de Mágicka por nível de Conjuração.'),
    'Conjuration Dual Casting': ('Conjuração Dupla de Conjuração', 'Conjurar com ambas as mãos dobra a duração e a resistência das criaturas e armas invocadas.'),
    'Atromancy': ('Atromancia', 'Aumenta a duração de Atronachs e familiares invocados em até 3 vezes.'),
    'Oblivion Stone (1)': ('Pedra do Oblivion I', 'Criaturas invocadas recebem 20% a mais de Vida e causam 15% a mais de dano.'),
    'Oblivion Stone (2)': ('Pedra do Oblivion II', 'Criaturas invocadas recebem 40% a mais de Vida e causam 30% a mais de dano.'),
    'Rift Summoner (1)': ('Invocador da Fenda I', 'Permite invocar criaturas e espíritos a até o dobro da distância padrão.'),
    'Rift Summoner (2)': ('Invocador da Fenda II', 'Permite invocar criaturas a até três vezes a distância padrão e reduz o tempo de conjuração.'),
    'Elemental Potency': ('Potência Elemental', 'Atronachs de Fogo, Gelo e Tempestade conjurados são versões Potentes e mais resilientes.'),
    'Elemental Conflux': ('Confluxo Elemental', 'Quando seu lacaio elemental estiver ativo, você recebe 25% de resistência ao elemento correspondente.'),
    'Twin Souls': ('Almas Gêmeas', 'Permite manter dois Atronachs, familiares ou mortos-vivos reanimados sob seu comando simultaneamente.'),
    'Mystic Binding': ('Vínculo Místico', 'Armas vinculadas (espadas, arcos e adagas mágicas) causam dano consideravelmente superior.'),
    'Hollow Binding': ('Vínculo do Vazio', 'Golpear com armas vinculadas drena 20 pontos de Mágicka por acerto de inimigos arcanos.'),
    'Void Brand': ('Marca do Vazio', 'Ataques com armas vinculadas infligem fraqueza a magia de 25% por 10 segundos no alvo atingido.'),

    # Heavy Armor & Block
    'Heavy Armor Mastery': ('Maestria em Armadura Pesada', 'Aumenta o índice de armadura pesada em 1% por nível de Armadura Pesada.'),
    'Heavy Armor Fit': ('Ajuste de Armadura Pesada', 'Aumenta o índice de armadura em 25% ao vestir um conjunto completo de Armadura Pesada.'),
    'Heavy Armor Training': ('Treinamento de Armadura Pesada', 'Armaduras pesadas pesam 50% menos quando equipadas e não penalizam a velocidade de movimento.'),
    'Cushioned (1)': ('Amortecimento I', 'Reduz o dano recebido de quedas em 50% ao usar conjunto pesado.'),
    'Matching Heavy Set': ('Conjunto Pesado Correspondente', 'Concede 20% de armadura bônus adicional ao vestir 4 peças pesadas do mesmo material.'),
    'Tower of Strength': ('Torre de Força', 'Reduz a perda de equilíbrio (stagger) em 50% ao sofrer impactos fortes.'),
    'Battle Fatigue': ('Fadiga de Batalha', 'Ataques desferidos contra você consomem 20% a mais de vigor do agressor se você estiver bloqueando.'),
    'Stoneheart': ('Coração de Pedra', 'Quando sua vida cair abaixo de 25%, seu índice de armadura dobra por 15 segundos.'),
    'Glancing Blows': ('Golpes de Raspão', 'Ataques recebidos que não forem de acerto crítico têm dano reduzido em 15% passivamente.'),
    'Face of the Mountain': ('Face da Montanha', 'Bloquear com escudo reflete 30% do dano de volta para o atacante e impede desestabilização frontal.'),
    'Block Mastery': ('Maestria em Bloqueio', 'Bloquear com escudo ou arma absorve 1% a mais de dano por nível de Bloqueio.'),
    'Elemental Protection': ('Proteção Elemental', 'Bloquear com um escudo reduz o dano recebido de Fogo, Gelo e Eletricidade em 50%.'),
    'Deflect Arrows': ('Desviar Flechas', 'Flechas inimigas que atingirem seu escudo não causam dano.'),
    'Shield Charge': ('Investida de Escudo', 'Correr enquanto mantém o escudo erguido derruba a maioria dos inimigos no chão.'),
    'Block Runner': ('Corredor com Bloqueio', 'Permite mover-se em velocidade normal de corrida mesmo enquanto mantém a postura de bloqueio.'),

    # One-Handed & Two-Handed
    'One-Handed Mastery': ('Maestria em Uma-Mão', 'Armas de uma mão causam 1% mais dano e 5% mais dano crítico por nível de Habilidade.'),
    'Two-Handed Mastery': ('Maestria em Duas-Mãos', 'Armas de duas mãos causam 1% mais dano e 5% mais dano crítico por nível de Habilidade.'),
    'Disciplined Fighter': ('Combatente Disciplinado', 'Ataques de poder consomem 25% menos Vigor (Stamina).'),
    'Brutal Fighter': ('Combatente Brutal', 'Ataques de poder consomem 25% menos Vigor e causam 15% a mais de dano.'),
    'Furious Strength': ('Força Furiosa', 'Ataques de poder causam 20% a mais de dano.'),
    'Ferocious Strength': ('Força Feroz', 'Ataques de poder de duas mãos causam 30% a mais de dano e têm chance de decapitar o alvo.'),
    'Denting Blows (1)': ('Golpes Contundentes I', 'Ataques reduzem o índice de armadura do alvo em 15 pontos por 15 segundos (acumula até 5 vezes).'),
    'Denting Blows (2)': ('Golpes Contundentes II', 'Ataques reduzem o índice de armadura do alvo em 30 pontos por 15 segundos (acumula até 5 vezes).'),
    'Overpowering Assault (1)': ('Assalto Avassalador I', 'Ataques de poder reduzem o dano de ataque do alvo em 20% por 5 segundos.'),
    'Overbearing Assault (1)': ('Assalto Opressor I', 'Ataques de poder com armas pesadas desestabilizam o inimigo e quebram a guarda de bloqueio.'),
    'Overbearing Assault (2)': ('Assalto Opressor II', 'Ataques de poder pesados causam 30% de dano esmagador que ignora 50% da armadura do alvo.'),
    'Raw Power (1)': ('Poder Bruto I', 'Armas normais e de duas mãos causam 10% a mais de dano físico puro.'),
    'Raw Power (2)': ('Poder Bruto II', 'Armas de duas mãos causam 20% a mais de dano físico puro.'),
    'Death or Glory': ('Morte ou Glória', 'Causa até 50% a mais de dano com armas brancas conforme a sua vida diminui.'),
    'Reap the Whirlwind': ('Colher o Redemoinho', 'Após desferir um contra-ataque ou aparar um golpe, seu próximo ataque de poder causa 40% a mais de dano.'),
    'Crowd Pleaser': ('Favorito da Multidão', 'Derrotar um inimigo em combate corporal restaura 50 pontos de Vigor imediatamente e concede velocidade bônus.'),
    'Dual Flurry (1)': ('Rajada Dupla I', 'Ataques com empunhadura dupla (duas armas ao mesmo tempo) são 20% mais rápidos.'),
    'Dual Flurry (2)': ('Rajada Dupla II', 'Ataques com empunhadura dupla são 35% mais rápidos.'),
    'Dual Savagery': ('Selvageria Dupla', 'Ataques de poder com empunhadura dupla causam 50% a mais de dano crítico.'),
    'Valorous Charge': ('Investida Valorosa', 'Permite desferir um ataque de poder em disparada que causa dano crítico dobrado.'),
    'Execute': ('Executar', 'Ataques de poder causam até 100% mais dano a inimigos que estejam com menos de 30% de Vida.'),
    'Bladedancer': ('Dançarino das Lâminas', 'Acertos críticos aumentam a velocidade de ataque em 15% por 5 segundos.'),
    'Victory Rush': ('Ímpeto da Vitória', 'Eliminar um inimigo restaura 100 pontos de Vigor e aumenta o dano do próximo ataque em 25%.'),

    # Light Armor & Sneak & Archery
    'Light Armor Mastery': ('Maestria em Armadura Leve', 'Aumenta o índice de armadura leve em 1% por nível de Armadura Leve.'),
    'Light Armor Fit': ('Ajuste de Armadura Leve', 'Aumenta o índice de proteção em 25% ao vestir um conjunto completo de Armadura Leve.'),
    'Light Armor Training': ('Treinamento de Armadura Leve', 'Armaduras leves equipadas pesam zero e não produzem ruído de movimento.'),
    'Agility': ('Agilidade', 'Aumenta a velocidade de regeneração de Vigor em 20% e a velocidade de corrida em 5%.'),
    'Wardancer': ('Dançarino de Guerra', 'Enquanto não for atingido por ataques bloqueados ou desarmados, você causa 20% a mais de dano.'),
    'Untouchable': ('Intocável', 'Esquivar-se de um ataque com sucesso concede 10% de velocidade de movimento e 15% de dano por 4 segundos.'),
    'Keen Senses': ('Sentidos Aguçados', 'Aumenta o índice de armadura leve em 20% mesmo se você não estiver usando um elmo.'),
    'Windrunner': ('Caminhante do Vento', 'A regeneração de Vigor é 50% mais rápida ao vestir armadura leve durante o combate.'),
    'Evasive Sprint': ('Disparada Evasiva', 'Correr em disparada reduz o dano de projéteis e feitiços recebidos em 30%.'),
    'Stimulants': ('Estimulantes', 'Consumir uma poção regenera 50 pontos de Vigor imediatamente e concede velocidade por 10 segundos.'),
    'Slow Metabolism (1)': ('Metabolismo Lento I', 'Poções benéficas e elixires duram 25% mais tempo.'),
    'Slow Metabolism (2)': ('Metabolismo Lento II', 'Poções e elixires duram 50% mais tempo.'),
    'Dodge Roll': ('Rolamento de Esquiva', 'Permite realizar um rolamento ágil para esquivar-se de golpes ao correr agachado.'),
    'Archery Mastery': ('Maestria em Arquearia', 'Arcos e bestas causam 1% a mais de dano por nível de Habilidade.'),
    'Eagle Eye': ('Olho de Águia', 'Segurar o botão de bloqueio com o arco retesado foca a visão ampliada sobre o alvo.'),
    'Steady Aim (1)': ('Mira Firme I', 'Aproximar a mira com o arco desacelera o tempo em 25%.'),
    'Steady Aim (2)': ('Mira Firme II', 'Aproximar a mira com o arco desacelera o tempo em 50%.'),
    "Hunter's Discipline": ('Disciplina do Caçador', 'Recupera o dobro de flechas e dardos dos corpos dos inimigos abatidos.'),
    'Power Shot': ('Disparo Poderoso', 'Flechas disparadas têm 50% de chance de desestabilizar (stagger) a maioria dos inimigos.'),
    'Quick Shot': ('Disparo Rápido', 'Permite retesar o arco 30% mais rápido.'),
    'Pinning Shot': ('Disparo Fixador', 'Flechas têm chance de paralisar o alvo temporariamente por 3 segundos.'),
    'Arrow to the Knee': ('Flecha no Joelho', 'Disparar contra as pernas de um inimigo em alcance reduz sua velocidade em 50% por 10 segundos.'),
    'Far Shot (1)': ('Tiro Longo I', 'Flechas causam até 20% a mais de dano conforme a distância do alvo aumenta além de 40 pés.'),
    'Far Shot (2)': ('Tiro Longo II', 'Flechas causam até 40% a mais de dano em alvos a longas distâncias.'),
    'Point Blank Shot (1)': ('Tiro à Queima-Roupa I', 'Flechas causam 20% a mais de dano a alvos dentro de um raio de 20 pés.'),
    'Point Blank Shot (2)': ('Tiro à Queima-Roupa II', 'Flechas causam 40% a mais de dano e têm alta chance de desestabilizar alvos próximos.'),
    'Ranger': ('Patrulheiro', 'Permite mover-se em velocidade total com o arco ou besta armado e engatilhado.'),
    'Gore': ('Chifrada', 'Atingir um inimigo correndo com ataque corporal enquanto segura o arco causa sangramento severo.'),
    'Adrenaline': ('Adrenalina', 'Quando sua vida cair abaixo de 30%, o tempo ao seu redor desacelera por 10 segundos.'),

    # Poison, Alchemy, Sneak & Trickster
    'Fangs (1)': ('Presas I', 'Lâminas banhadas em veneno causam 25% mais dano de toxina e corrosão.'),
    'Fangs (2)': ('Presas II', 'Lâminas envenenadas reduzem a resistência a veneno do alvo em 30%.'),
    'Concentrated Poison (1)': ('Veneno Concentrado I', 'Venenos aplicados a armas duram por 2 ataques antes de se esgotarem.'),
    'Concentrated Poison (2)': ('Veneno Concentrado II', 'Venenos aplicados a armas duram por 3 ataques consecutivos.'),
    'Concentrated Poison (3)': ('Veneno Concentrado III', 'Venenos aplicados a armas duram por 5 ataques sem necessidade de reaplicação.'),
    'Alkahest': ('Alkahest', 'Seus venenos corroem armaduras metálicas, reduzindo o índice defensivo do alvo em 100 pontos.'),
    'Plague Doctor': ('Médico da Peste', 'Inimigos envenenados por você transmitem uma nuvem tóxica a aliados próximos ao redor.'),
    'Spitting Cobra': ('Cobra Cuspidora', 'Ataques furtivos envenenados aplicam efeito de cegueira e corrosão prolongada.'),
    'Sneak Mastery': ('Maestria em Furtividade', 'Você fica 1% mais difícil de ser detectado por nível de Furtividade.'),
    'Sneak Attack': ('Ataque Furtivo', 'Ataques desferidos sem ser detectado causam dano furtivo amplificado.'),
    'Silent Movement': ('Movimento Silencioso', 'Reduz o ruído produzido por suas passadas em 50%.'),
    'Silent Movement (1)': ('Movimento Silencioso I', 'Reduz o ruído produzido por suas passadas em 50%.'),
    'Silent Movement (2)': ('Movimento Silencioso II', 'Passos e caminhadas são 100% silenciosos para os ouvidos inimigos.'),
    'Backstab': ('Apunhalada pelas Costas', 'Ataques furtivos com espadas de uma mão causam 6 vezes o dano normal.'),
    "Assassin's Blade": ('Lâmina do Assassino', 'Ataques furtivos com adagas causam impressionantes 15 vezes o dano normal.'),
    'Cloak and Dagger': ('Capa e Adaga', 'Romper a invisibilidade com um ataque furtivo garante 100% de chance de acerto crítico.'),
    'Shadow Warrior': ('Guerreiro das Sombras', 'Agachar-se durante o combate faz com que os inimigos percam seu rastro temporariamente.'),
    'Quiet Casting': ('Conjuração Silenciosa', 'Todos os feitiços e gritos lançados por você são completamente silenciosos.'),
    'Animage (1)': ('Animago I', 'Mind affecting spells and effects work on creatures and people up to 10/20/40 levels higher, and other targets up to 5/10/20 levels higher.'),
    'Animage (2)': ('Animago II', 'Mind affecting spells and effects work on creatures and people up to 10/20/40 levels higher, and other targets up to 5/10/20 levels higher.'),
    'Animage (3)': ('Animago III', 'Mind affecting spells and effects work on creatures and people up to 10/20/40 levels higher, and other targets up to 5/10/20 levels higher.'),
    'Silent Roll (1)': ('Rolamento Silencioso', 'Permite realizar rolamentos furtivos em velocidade rápida sem fazer barulho.'),
    'Shadowcaster': ('Conjurador das Sombras', 'Lançar feitiços de ilusão sob a escuridão reduz o custo em 50%.'),
    'Blur': ('Desfoque', 'Cria distorções ao seu redor que desviam 30% das flechas e golpes desferidos.'),
    "Hethoth's Escape": ('Fuga de Hethoth', 'Quando receber um golpe fatal iminente, teleporta-se 10 metros para trás em fumaça ilusória.'),
    'Bear Hide': ('Pele de Urso', 'Reduz todo o dano físico recebido em 15% passivamente quando em combate prolongado.')
}

# 1. Generate perks-descriptions.json
final_perks_descriptions = {}
for p_name, p_desc in all_perks_raw.items():
    clean_name = p_name.strip()
    if clean_name in pt_translations:
        pt_n, pt_d = pt_translations[clean_name]
    else:
        pt_n = clean_name
        pt_d = p_desc if p_desc else f'Habilidade de combate aprimorada: {clean_name}.'

    final_perks_descriptions[clean_name] = {
        'name': clean_name,
        'namePt': pt_n,
        'descriptionPt': pt_d,
        'originalDesc': p_desc
    }

for c_name, st_map in raw['prog_perks'].items():
    for lvl, p_list in st_map.items():
        for p in p_list:
            if p not in final_perks_descriptions:
                pt_n, pt_d = pt_translations.get(p, (p, f'Concede a habilidade passiva de combate {p}.'))
                final_perks_descriptions[p] = {
                    'name': p,
                    'namePt': pt_n,
                    'descriptionPt': pt_d,
                    'originalDesc': ''
                }

os.makedirs(CONFIG_DIR, exist_ok=True)
with open(os.path.join(CONFIG_DIR, 'perks-descriptions.json'), 'w', encoding='utf-8') as f:
    json.dump(final_perks_descriptions, f, indent=2, ensure_ascii=False)
print('Generated config/perks-descriptions.json')

# 2. Generate perk-mappings.json for dynamic resolution
perk_mappings = {}
for p_name in final_perks_descriptions.keys():
    clean_id = p_name.replace(' ', '').replace('(', '').replace(')', '').replace("'", '').replace('-', '_').replace(':', '')
    perk_mappings[p_name] = {
        'name': p_name,
        'localId': '0x000000',
        'candidatePlugins': [
            'Vokrii - Minimalistic Perks of Skyrim.esp',
            'Vokrii.esp',
            'Vokrii.esl',
            'Skyrim.esm',
            'Update.esm'
        ],
        'editorIdAliases': [
            f'VKR_{clean_id}',
            clean_id,
            f'Perk_{clean_id}',
            p_name
        ]
    }

with open(os.path.join(CONFIG_DIR, 'perk-mappings.json'), 'w', encoding='utf-8') as f:
    json.dump(perk_mappings, f, indent=2, ensure_ascii=False)
print('Generated config/perk-mappings.json')

# 3. Generate classes-config.json
archetype_mapping = {
    'ELEMENTALISTA': ('CONJURADORES', True),
    'CRIOMANTE': ('CONJURADORES', True),
    'ELETROMANTE': ('CONJURADORES', True),
    'PIROMANTE': ('CONJURADORES', True),
    'INVOCADOR': ('CONJURADORES', True),
    'ANTI-MAGO': ('CONJURADORES', False),
    'GUARDIÃO': ('GUERREIROS', False),
    'BERSERKER': ('GUERREIROS', False),
    'CAVALEIRO NEGRO': ('GUERREIROS', False),
    'PALADINO': ('GUERREIROS', False),
    'MESTRE ESPADACHIM': ('GUERREIROS', False),
    'DRUÍDA': ('GUERREIROS', False),
    'ARQUEIRO (SNIPER)': ('ESPECIALISTAS', False),
    'RANGER (CURTA DISTÂNCIA)': ('ESPECIALISTAS', False),
    'VIPER (VENENO)': ('ESPECIALISTAS', False),
    'ASSASSINO': ('ESPECIALISTAS', False),
    'CURANDEIRO': ('ESPECIALISTAS', True),
    'TRAPACEIRO': ('ESPECIALISTAS', False)
}

display_names = {
    'ARQUEIRO (SNIPER)': 'ARQUEIRO',
    'RANGER (CURTA DISTÂNCIA)': 'RANGER',
    'VIPER (VENENO)': 'VIPER'
}

classes_config = {}
for c_key, c_val in raw['classes'].items():
    arch, req_wh = archetype_mapping.get(c_key, ('ESPECIALISTAS', False))
    disp_name = display_names.get(c_key, c_key)
    c_id = disp_name.lower().replace(' ', '_').replace('(', '').replace(')', '').replace('-', '_').replace('ã', 'a').replace('í', 'i').replace('á', 'a').replace('é', 'e')

    stages = []
    p_stages = raw['prog_perks'].get(c_key, {})
    s_stages = raw['prog_skills'].get(c_key, {})

    for lvl in [0, 5, 10, 15, 20, 25, 30, 35, 40]:
        lvl_num = int(lvl)
        perks = p_stages.get(str(lvl), p_stages.get(lvl, []))
        skills_str = s_stages.get(str(lvl), s_stages.get(lvl, ''))
        stages.append({
            'level': 1 if lvl_num == 0 else lvl_num,
            'stageNumber': 1 if lvl_num == 0 else (lvl_num // 5) + 1,
            'perks': perks,
            'skills': skills_str,
            'attributePoints': 15
        })

    auth_spells = raw['prog_spells'].get(c_key, {})
    classes_config[c_id] = {
        'id': c_id,
        'key': c_key,
        'name': disp_name,
        'fullName': c_key,
        'archetype': arch,
        'requiresWinterholdStudent': req_wh,
        'description': c_val['description'],
        'stages': stages,
        'authorizedSpells': auth_spells,
        'allSpellsList': c_val['spells'],
        'spellsRPNotice': 'Os feitiços desta classe não são concedidos automaticamente pelo sistema. Devem ser aprendidos através de Roleplay junto ao Colégio de Winterhold com os professores e livros mágicos.'
    }

with open(os.path.join(CONFIG_DIR, 'classes-config.json'), 'w', encoding='utf-8') as f:
    json.dump(classes_config, f, indent=2, ensure_ascii=False)
print('Generated config/classes-config.json. Total classes:', len(classes_config))
